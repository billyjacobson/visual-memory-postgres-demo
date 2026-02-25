Date: Jan 28, 2026   
Co-Authors: [Billy Jacobson](mailto:thebilly@google.com)  
Reviewers: [Brad Miro](mailto:bmiro@google.com)[Yoav Eilat](mailto:yeilat@google.com)  
[Data Cloud Demos Guide - \[SC26\] Learn Pods at Next 26](https://docs.google.com/document/d/1cuHusz_emphL6YmG8R_bKmW1HiMs_Xb_9bQTYtLm3-E/edit?resourcekey=0-qVyDFrCwF7eqgso6VNvR7A&tab=t.x5cxgd6dif59)

**Title:** Living Memory: The Adaptive AI Cortex 

**One liner:** Peer into the mind of an AI model with a conversational agent that builds a persistent, visual "brain" of user facts over time. See how databases can power long-term AI memory with enterprise-grade management and retrieval.

**How it's built:** Chat interactions are processed through a pipeline anchored in Cloud SQL

* **Frictionless Setup:** The entire database infrastructure is provisioned and configured using the **Managed MCP Server**. The developer uses Gemini CLI to simply ask, "Spin up a Cloud SQL instance for a memory app," bypassing complex console setup.  
* **Memory Extraction:** As the user chats, a background Gemini model analyzes the conversation to extract semantic triples (Subject \-\> Predicate \-\> Object) and categorizes them (e.g., Facts, Preferences, Style).  
* **Vector Storage:** These extracted memories are embedded and stored in **Cloud SQL (PostgreSQL with pgvector)**. This allows the application to perform semantic searches on past context (e.g., relating "budgeting" to "travel plans").  
* **Graph Visualization:** The frontend queries Cloud SQL to render a dynamic node-graph. Relationships between memories are established via foreign keys and semantic similarity, creating a visual web of the user's identity.

**How it’s presented:** Attendees see a split-screen UI: a chat interface on the left and a floating 3D galaxy of nodes (the "Brain") on the right.

* **Initial Chat:** The user (Persona: "Sam") types a casual message: *"I'm trying to plan a weekend getaway for my anniversary next month."*  
* **Visual Reaction:** Immediately, the "Brain" on the right reacts. New nodes pop into existence, pulsing with color:  
  * **Fact (Blue):** "Anniversary is in February"  
  * **Preference (Pink):** "Planning a weekend trip"  
  * **Connection:** Lines draw automatically between "Travel" and "Anniversary."  
* **Contextual Recall:** The user asks, *"Where should we go?"*  
  * The AI responds, *"Since you usually prefer **colder climates** (referencing a previous 'Preference' memory node) and enjoy **hiking**..."*  
  * *Demo Moment:* Highlight how the AI didn't just look at the last message, but queried the Cloud SQL vector store to pull relevant "Hobby" nodes from previous sessions.  
* **The "Under the Hood" Reveal (MCP):** We pause to show how we interact with the data.  
  * Instead of opening a SQL client, we open the **Gemini CLI**.  
  * We type: *"Show me the most frequently accessed memory category for Sam."*  
  * The **Managed MCP Server** translates this to a SQL query and returns the answer in natural language: *"Sam's most frequent category is 'Outdoor Activities'."*