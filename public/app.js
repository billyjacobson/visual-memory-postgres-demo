const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatWindow = document.getElementById('chat-window');

let currentUserId = null;
let currentConvId = null;

// Initialize 3D Graph
const Graph = ForceGraph3D()
  (document.getElementById('graph-3d'))
  .backgroundColor('rgba(0,0,0,0)') // Transparent to show CSS gradient
  .nodeAutoColorBy('group')
  .linkColor(() => 'rgba(255,255,255,0.2)')
  .nodeThreeObject(node => {
    // Create custom visual spheres based on Memory Type
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: getColorForType(node.type) })
    );

    // Base scale
    let scale = 12;

    // Pink explicit preferences are slightly larger
    if (node.type === 'PREF') {
      scale = 16;
    }

    sprite.scale.set(scale, scale, 1);
    return sprite;
  })
  .onNodeHover(node => {
    // Change cursor to pointer
    document.getElementById('graph-3d').style.cursor = node ? 'pointer' : null;
  })
  .onNodeClick(node => {
    // Focus camera on node when clicked
    const distance = 80;
    const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);

    Graph.cameraPosition(
      { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
      node,
      3000  // ms transition duration
    );
  });

// Determine Node Color
function getColorForType(type) {
  switch (type) {
    case 'FACT': return '#38bdf8'; // Blue
    case 'PREF': return '#f472b6'; // Pink
    case 'IMPLICIT': return '#fbbf24'; // Gold
    default: return '#ffffff';
  }
}

// Fetch Memories from Backend
async function refreshBrain() {
  if (!currentUserId) return;

  try {
    const res = await fetch(`/api/memories?userId=${currentUserId}`);
    const data = await res.json();

    Graph.graphData(data);

    // Add slow rotation to make it feel alive
    let angle = 0;
    setInterval(() => {
      Graph.cameraPosition({
        x: 200 * Math.sin(angle),
        z: 200 * Math.cos(angle)
      });
      angle += Math.PI / 1000;
    }, 30);

  } catch (err) {
    console.error("Failed to load brain data:", err);
  }
}

// Handle Chat Submission
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (!msg) return;

  // 1. Render User Message
  appendMessage(msg, 'user-message');
  chatInput.value = '';

  try {
    // 2. Send to Backend
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        userId: currentUserId,
        conversationId: currentConvId
      })
    });

    const data = await res.json();

    // Track IDs for session persistence
    currentUserId = data.userId;
    currentConvId = data.conversationId;

    // 3. Render AI Response
    appendMessage(data.response, 'ai-message', data.memoriesUsed);

    // 4. Highlight Retrieved Memories in the 3D Graph
    highlightMemories(data.memoriesUsed);

    // 5. Refresh the brain data in case NEW memories were extracted
    // Setup a short delay so the extraction has time to save to DB asynchronously
    setTimeout(() => refreshBrain(), 3000);

  } catch (err) {
    console.error("Chat Error:", err);
    appendMessage("An error occurred. Please try again.", 'ai-message');
  }
});

// Helper: Append Message to UI
function appendMessage(text, className, contextItems = []) {
  const div = document.createElement('div');
  div.className = `message ${className}`;

  // Add context visualizer if we used memory to generate this response
  if (contextItems && contextItems.length > 0) {
    div.classList.add('has-context');
    const tooltip = document.createElement('div');
    tooltip.className = 'context-hit';
    tooltip.textContent = `Retrieved ${contextItems.length} memories`;
    div.appendChild(tooltip);
  }

  div.appendChild(document.createTextNode(text));
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Helper: Pulse/Highlight nodes that were queried
function highlightMemories(memoriesHit) {
  if (!memoriesHit || memoriesHit.length === 0) return;

  // Visual node highlighting logic can go here.
  // For the MVP, we just zoom the camera to the first hit.
  const firstHitId = memoriesHit[0].id;
  const graphData = Graph.graphData();
  const targetNode = graphData.nodes.find(n => n.id === firstHitId);

  if (targetNode) {
    // Focus camera on node
    const distance = 60;
    const distRatio = 1 + distance / Math.hypot(targetNode.x, targetNode.y, targetNode.z);

    Graph.cameraPosition(
      { x: targetNode.x * distRatio, y: targetNode.y * distRatio, z: targetNode.z * distRatio },
      targetNode,
      2000
    );
  }
}
