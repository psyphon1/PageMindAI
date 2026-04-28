# PageMindAI — Universal RAG Chatbot 🧠✨

> **Chat with any YouTube video or website in seconds.**
> PageMindAI is a powerful Chrome Extension + FastAPI backend that leverages Retrieval-Augmented Generation (RAG) to turn the web into your personal knowledge base.

---

## 🌟 Features

- 🎥 **YouTube Intelligence**: Auto-extracts transcripts, descriptions, and comments. No more watching 30-minute videos for a 10-second answer.
- 🌐 **Universal Web Support**: Works on blogs, documentation, and news articles using advanced semantic scraping.
- 🤖 **State-of-the-Art LLMs**: Powered by **Llama 3.3 (70B)** for YouTube and **Llama 3.1 (8B)** for websites via **Groq**.
- ⚡ **Lightning Fast**: Uses **FAISS** for vector search and **FastEmbed** for local, efficient embeddings.
- 🎨 **Sleek UI**: Modern dark-mode interface with real-time indexing status and chat history.
- 🛠 **Developer First**: Easy to deploy with Docker or Railway. Fully open-source.

---

## 🏗 How It Works

1. **Detection**: When you open the extension, `content.js` identifies the page type (YouTube vs. Website).
2. **Extraction**: 
   - **YouTube**: Injects logic to find hidden transcript data, fetches it, and grabs metadata.
   - **Website**: Cleans the DOM, removes noise (nav, footers, ads), and extracts the core content.
3. **Indexing**: The content is sent to the FastAPI backend where it is chunked, embedded with `BGE-small`, and stored in a temporary FAISS vector store.
4. **Conversation**: Your questions are processed through a `ConversationalRetrievalChain`, ensuring the AI stays grounded in the page context.

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Chrome Manifest V3, Vanilla JS, CSS3 (Glassmorphism) |
| **Backend** | FastAPI, Python 3.11+ |
| **RAG Orchestration** | LangChain |
| **LLM Provider** | Groq (Llama 3.3-70B-Versatile / Llama 3.1-8B-Instant) |
| **Embeddings** | FastEmbed (BAAI/bge-small-en-v1.5) |
| **Vector Store** | FAISS (In-memory) |
| **Scraping** | BeautifulSoup4 (for backend), DOM API (for frontend) |

---

## 🚀 Getting Started

### 1. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Configure your API key
cp .env.example .env
# Edit .env and add: GROQ_API_KEY=gsk_...

# Run the server
python run.py  # or uvicorn main:app --reload
```

### 2. Chrome Extension Setup

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder in this repo.
4. Click the extension icon, set your Backend URL in the settings (default: `http://localhost:8000`), and you're ready!

---

## 📂 Project Structure

```text
universal-rag/
├── backend/
│   ├── main.py            # FastAPI entry point & API routes
│   ├── rag_youtube.py     # YouTube-specific RAG pipeline (Llama 3.3-70B)
│   ├── rag_website.py     # Website-specific RAG pipeline (Llama 3.1-8B)
│   ├── requirements.txt   # Backend dependencies
│   └── .env               # API keys & Configuration
├── extension/
│   ├── manifest.json      # Extension metadata & permissions
│   ├── popup.html/js      # Chat interface & logic
│   ├── content.js         # Client-side extraction engine
│   └── background.js      # Service worker & API bridge
└── run.py                 # Root execution script
```

---

## 📝 Configuration & Limitations

- **Groq API Key**: Required for LLM inference. Get one at [console.groq.com](https://console.groq.com).
- **YouTube Transcripts**: Requires videos that have captions/transcripts enabled.
- **Session Persistence**: To keep things fast and private, vector stores are held in-memory and cleared periodically.

---

## 🌐 Repository & Deployment

- **Repository**: [github.com/psyphon1/PageMindAI](https://github.com/psyphon1/PageMindAI)
- **Primary Branch**: `main` (unified single branch for production & development)
- **Latest Commit**: Branch consolidation complete - master merged into main
- **Status**: ✅ Active Development & Maintenance

---

## 📋 Recent Updates

- ✅ Initial project structure committed and pushed
- ✅ Unified repository to single `main` branch (removed `master`)
- ✅ Conflict resolution completed with latest updates integrated
- ✅ Ready for deployment and contributions

---

## 👨‍💻 Author

Developed by **Chinmay Duse** (firefox technologies).
Find me on [LinkedIn](https://www.linkedin.com/in/chinmay-duse/) or [GitHub](https://github.com/psyphon1).

---
*If you find this project useful, please consider giving it a ⭐!*
