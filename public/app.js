const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatWindow = document.getElementById('chat-window');
const userSelect = document.getElementById('user-select');
const createUserBtn = document.getElementById('create-user-btn');
const convSelect = document.getElementById('conversation-select');
const newChatBtn = document.getElementById('new-chat-btn');

let currentUserId = null;
let currentConvId = null;

// Initialize 2D Graph matching the python reference visualization
const graphElem = document.getElementById('graph-3d');
const Graph = ForceGraph()
  (graphElem)
  .width(graphElem.clientWidth)
  .height(graphElem.clientHeight)
  .backgroundColor('rgba(0,0,0,0)') // Transparent to show CSS gradient
  .nodeRelSize(8)
  // Use custom link drawing instead of default lines
  .nodePointerAreaPaint((node, color, ctx) => {
    const size = node.size || 8;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
    ctx.fill();
  })
  .nodeCanvasObject((node, ctx, globalScale) => {
    // 1. Draw the Circle using dynamic size from backend
    const size = node.size || 8;
    const color = getColorForType(node.type);

    ctx.beginPath();
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
    ctx.fillStyle = color;
    ctx.fill();

    // Draw green circle around node if highlighted
    if (node.highlighted) {
      ctx.beginPath();
      // Make the green circle a bit larger than the node
      ctx.arc(node.x, node.y, size + 3, 0, 2 * Math.PI, false);
      ctx.strokeStyle = '#22c55e'; // Green
      ctx.lineWidth = 2.5 / globalScale; // Thinner stroke when zoomed out
      ctx.stroke();
    }

    // 2. Draw the Text Label
    const fontSize = 12 / globalScale; // Scale text size based on zoom, but keep readable
    const cleanFontSize = Math.max(2, Math.min(10, fontSize)); // Clamp between 2px and 10px in graph space
    ctx.font = `${cleanFontSize}px "Playfair Display", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    let text = node.name || '';
    const words = text.split(' ');

    // Word wrapping logic
    const maxWidth = 80; // max width in graph coordinates
    const lines = [];
    let currentLine = words[0] || '';

    // Track the absolute widest line to draw the background box accurately
    let maxComputedWidth = ctx.measureText(currentLine).width;

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = ctx.measureText(currentLine + " " + word).width;
      if (width < maxWidth) {
        currentLine += " " + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
      const currentLineWidth = ctx.measureText(currentLine).width;
      if (currentLineWidth > maxComputedWidth) maxComputedWidth = currentLineWidth;
    }
    lines.push(currentLine);

    const lineHeight = cleanFontSize * 1.2;
    const totalTextHeight = lines.length * lineHeight;
    let yOffset = node.y + size + 2;

    // 3. Draw Background Box Pill behind the text
    const paddingX = 4;
    const paddingY = 2;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)'; // Transparent Slate-900 matching the UI theme

    // Draw rounded rectangle for background
    ctx.beginPath();
    ctx.roundRect(
      node.x - (maxComputedWidth / 2) - paddingX,
      yOffset - paddingY,
      maxComputedWidth + (paddingX * 2),
      totalTextHeight + (paddingY * 2),
      4 // Border radius
    );
    ctx.fill();

    // 4. Draw the actual text over the background box
    ctx.fillStyle = '#f8f9fa';
    lines.forEach(line => {
      ctx.fillText(line, node.x, yOffset);
      yOffset += lineHeight;
    });
  })
  .linkCanvasObjectMode(() => 'replace')
  .linkCanvasObject((link, ctx) => {
    // Draw edges manually to control opacity based on thickness (value)
    const opacity = Math.min(0.4, (link.value / 25));
    ctx.beginPath();
    ctx.moveTo(link.source.x, link.source.y);
    ctx.lineTo(link.target.x, link.target.y);
    ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
    ctx.lineWidth = link.value || 1;
    ctx.stroke();
  })
  .onNodeHover(node => {
    // Change cursor to pointer
    document.getElementById('graph-3d').style.cursor = node ? 'pointer' : null;
  })
  .onNodeClick(node => {
    // Pan and zoom to node
    Graph.centerAt(node.x, node.y, 1000);
    Graph.zoom(8, 2000);
  });

// Match Barnes-Hut mechanics from the Python Notebook
Graph.d3Force('charge').strength(-800); // Increased repulsion to spread nodes out
Graph.d3Force('link').distance(150);     // Longer springs for more spacious clusters

// Add explicit collision force to prevent nodes from overlapping
Graph.d3Force('collide', d3.forceCollide(node => (node.size || 8) + 40).iterations(3));

// Central gravity keeps the whole graph centered
Graph.d3Force('center').strength(0.05);

// Keep graph rendering bounds strictly within its visible container
window.addEventListener('resize', () => {
  Graph.width(graphElem.clientWidth).height(graphElem.clientHeight);
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
  if (!currentUserId) {
    Graph.graphData({ nodes: [], links: [] });
    return;
  }

  try {
    const res = await fetch(`/api/memories?userId=${currentUserId}`);
    const data = await res.json();
    Graph.graphData(data);
    setTimeout(() => {
      // Center on the visual cluster (center of mass) instead of strict bounding box
      const nodes = Graph.graphData().nodes;
      if (nodes.length > 0) {
        const sumX = nodes.reduce((sum, n) => sum + (n.x || 0), 0);
        const sumY = nodes.reduce((sum, n) => sum + (n.y || 0), 0);
        Graph.centerAt(sumX / nodes.length, sumY / nodes.length, 1000);
      }
      Graph.zoom(0.6, 1000); // 0.6 God-view zoom out
    }, 1000);
  } catch (err) {
    console.error("Failed to load brain data:", err);
  }
}

// Load Users
async function loadUsers(autoSelectId = null) {
  try {
    const res = await fetch('/api/users');
    const users = await res.json();

    userSelect.innerHTML = '<option value="">Select User...</option>';
    users.forEach(u => {
      const option = document.createElement('option');
      option.value = u.id;
      option.textContent = u.persona_name;
      userSelect.appendChild(option);
    });

    if (autoSelectId) {
      userSelect.value = autoSelectId;
      await handleUserSwitch();
    } else if (users.length > 0) {
      userSelect.value = users[0].id;
      await handleUserSwitch();
    }

    return users;
  } catch (err) {
    console.error("Error loading users:", err);
    return [];
  }
}

// Load Conversations for User
async function loadConversations(userId, autoSelectConvId = null) {
  try {
    const res = await fetch(`/api/conversations/${userId}`);
    const convs = await res.json();

    convSelect.innerHTML = '<option value="">New Conversation</option>';
    convs.forEach(c => {
      const option = document.createElement('option');
      option.value = c.id;
      const dateStr = new Date(c.started_at).toLocaleString();
      option.textContent = `Chat: ${dateStr}`;
      convSelect.appendChild(option);
    });

    if (autoSelectConvId) {
      convSelect.value = autoSelectConvId;
    } else if (convs.length > 0) {
      convSelect.value = convs[0].id; // Select most recent
    } else {
      convSelect.value = ""; // New conversation
    }

    await handleConvSwitch();
  } catch (err) {
    console.error("Error loading conversations:", err);
  }
}

// Load Messages for Conversation
async function loadMessages(convId) {
  chatWindow.innerHTML = ''; // Clear current

  if (!convId) {
    appendMessage("👋 Hello! I'm Sam. I remember everything we talk about. What's on your mind?", "ai-message");
    return;
  }

  try {
    const res = await fetch(`/api/messages/${convId}`);
    const msgs = await res.json();

    if (msgs.length === 0) {
      appendMessage("👋 Hello! I'm Sam. I remember everything we talk about. What's on your mind?", "ai-message");
    } else {
      msgs.forEach(m => {
        const className = m.role === 'user' ? 'user-message' : 'ai-message';
        appendMessage(m.content, className);
      });
    }
  } catch (err) {
    console.error("Error loading messages:", err);
  }
}

// Handlers
async function handleUserSwitch() {
  currentUserId = userSelect.value || null;
  refreshBrain();
  if (currentUserId) {
    await loadConversations(currentUserId);
  } else {
    convSelect.innerHTML = '<option value="">New Conversation</option>';
    currentConvId = null;
    chatWindow.innerHTML = '';
  }
}

async function handleConvSwitch() {
  currentConvId = convSelect.value || null;
  await loadMessages(currentConvId);
}

userSelect.addEventListener('change', handleUserSwitch);
convSelect.addEventListener('change', handleConvSwitch);

createUserBtn.addEventListener('click', () => {
  document.getElementById('user-modal').style.display = 'flex';
  document.getElementById('new-user-input').focus();
});

document.getElementById('cancel-user-btn').addEventListener('click', () => {
  document.getElementById('user-modal').style.display = 'none';
  document.getElementById('new-user-input').value = '';
});

document.getElementById('submit-user-btn').addEventListener('click', async () => {
  const nameInput = document.getElementById('new-user-input');
  const name = nameInput.value;
  if (!name || !name.trim()) return;

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona_name: name.trim() })
    });
    const newUser = await res.json();

    // Reload the users dropdown softly
    const usersRes = await fetch('/api/users');
    const users = await usersRes.json();
    userSelect.innerHTML = '<option value="">Select User...</option>';
    users.forEach(u => {
      const option = document.createElement('option');
      option.value = u.id;
      option.textContent = u.persona_name;
      userSelect.appendChild(option);
    });

    // Clean up modal
    document.getElementById('user-modal').style.display = 'none';
    nameInput.value = '';

    // Select the new user and trigger the hard load to clear chat/convs
    userSelect.value = newUser.id;
    await handleUserSwitch();

  } catch (err) {
    console.error("Failed to create user:", err);
    alert("Failed to create user.");
  }
});

newChatBtn.addEventListener('click', () => {
  if (!currentUserId) return alert("Select a user first");
  convSelect.value = "";
  handleConvSwitch();
});

// Seed Initial Data if Empty
async function initApp() {
  const users = await loadUsers();
  const hasDemoUser = users.some(u => u.persona_name === 'Demo User');

  if (!hasDemoUser) {
    console.log("Demo User not found. Auto-seeding Demo User...");
    try {
      const res = await fetch('/api/seed', { method: 'POST' });
      const seedData = await res.json();
      await loadUsers(seedData.userId);
    } catch (err) {
      console.error("Failed to seed database:", err);
    }
  } else {
    // If Demo User exists, let's select it by default for the demo
    const demoUser = users.find(u => u.persona_name === 'Demo User');
    if (demoUser && currentUserId !== demoUser.id) {
      await loadUsers(demoUser.id);
    }
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

  // Add the typing indicator visually while fetching
  const typingIndicator = document.createElement('div');
  typingIndicator.className = 'message ai-message';
  typingIndicator.id = 'typing-indicator';
  typingIndicator.innerHTML = '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
  chatWindow.appendChild(typingIndicator);
  chatWindow.scrollTop = chatWindow.scrollHeight;

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

    // Remove the typing indicator now that we have data
    const existingIndicator = document.getElementById('typing-indicator');
    if (existingIndicator) existingIndicator.remove();

    // Track IDs for session persistence (if this was a new user/conv)
    if (currentUserId !== data.userId || currentConvId !== data.conversationId) {
      const isNewUser = currentUserId !== data.userId;
      const isNewConv = currentConvId !== data.conversationId;

      currentUserId = data.userId;
      currentConvId = data.conversationId;

      // Soft-reload dropdowns to visually update them WITHOUT triggering full reload cascades (which cause duplicate appends)
      if (isNewUser) {
        const usersRes = await fetch('/api/users');
        const users = await usersRes.json();
        userSelect.innerHTML = '<option value="">Select User...</option>';
        users.forEach(u => {
          const option = document.createElement('option');
          option.value = u.id;
          option.textContent = u.persona_name;
          userSelect.appendChild(option);
        });
        userSelect.value = currentUserId;
      }

      if (isNewConv) {
        const convsRes = await fetch(`/api/conversations/${currentUserId}`);
        const convs = await convsRes.json();
        convSelect.innerHTML = '<option value="">New Conversation</option>';
        convs.forEach(c => {
          const option = document.createElement('option');
          option.value = c.id;
          const dateStr = new Date(c.started_at).toLocaleString();
          option.textContent = `Chat: ${dateStr}`;
          convSelect.appendChild(option);
        });
        convSelect.value = currentConvId;
      }
    }

    // 3. Render AI Response
    appendMessage(data.response, 'ai-message', data.memoriesUsed);

    // 4. Highlight Retrieved Memories in the 3D Graph
    highlightMemories(data.memoriesUsed);

    // 5. Refresh the brain data in case NEW memories were extracted
    setTimeout(() => refreshBrain(), 3000);

  } catch (err) {
    const existingIndicator = document.getElementById('typing-indicator');
    if (existingIndicator) existingIndicator.remove();
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

    // Make the message clickable to re-highlight the graph
    div.title = "Click to view memory context in graph";
    div.style.cursor = "pointer";
    div.addEventListener('click', () => {
      // Small visual feedback on click
      div.style.transform = "scale(0.98)";
      setTimeout(() => div.style.transform = "none", 150);
      highlightMemories(contextItems);
    });
  }

  // Use marked for AI messages to render Markdown. Need an inner container for the HTML.
  if (className === 'ai-message') {
    const contentDiv = document.createElement('div');
    contentDiv.className = 'markdown-content';

    // Check if marked is loaded
    if (typeof window.marked !== 'undefined') {
      contentDiv.innerHTML = window.marked.parse(text);
    } else {
      console.warn("marked library is not loaded, falling back to text text nodes.");
      contentDiv.appendChild(document.createTextNode(text));
      // Fallback CSS to preserve newlines
      contentDiv.style.whiteSpace = 'pre-wrap';
    }
    div.appendChild(contentDiv);
  } else {
    // Escape user messages or gracefully fall back
    div.style.whiteSpace = 'pre-wrap';
    div.appendChild(document.createTextNode(text));
  }

  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Helper: Pulse/Highlight nodes that were queried
function highlightMemories(memoriesHit) {
  if (!memoriesHit || memoriesHit.length === 0) return;

  const hitIds = new Set(memoriesHit.map(m => m.id));
  const { nodes, links } = Graph.graphData();

  if (!nodes) return;

  // Set highlighted flag on nodes
  nodes.forEach(node => {
    node.highlighted = hitIds.has(node.id);
  });

  // Force re-render of the canvas to show the green highlights
  Graph.nodeRelSize(8); // Harmless way to trigger a re-render natively
}

// START APP
initApp();
