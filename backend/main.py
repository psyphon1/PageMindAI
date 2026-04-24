from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import logging
import os
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables from backend/.env
env_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=env_path)

logger.info(f"Loading .env from: {env_path}")
key = os.getenv("GROQ_API_KEY")
if key:
    logger.info(f"GROQ_API_KEY found (starts with: {key[:10]}...)")
else:
    logger.error("GROQ_API_KEY NOT FOUND in environment!")

from rag_youtube import YouTubeRAG
from rag_website import WebsiteRAG

app = FastAPI(title="PageMindAI API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production to your extension ID
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session cache: session_id -> RAG instance
rag_cache: dict = {}


class LoadRequest(BaseModel):
    session_id: str
    type: str          # "youtube" or "website"
    video_id: Optional[str] = None
    url: Optional[str] = None
    text: Optional[str] = None   # pre-extracted text from content.js
    transcript: Optional[str] = None
    description: Optional[str] = None
    comments: Optional[str] = None


class ChatRequest(BaseModel):
    session_id: str
    question: str


class LoadResponse(BaseModel):
    session_id: str
    status: str
    message: str
    char_count: Optional[int] = None


class ChatResponse(BaseModel):
    answer: str
    sources: list[str] = []


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/load", response_model=LoadResponse)
async def load_content(req: LoadRequest):
    """Load and index content for a page (YouTube or website)."""
    try:
        if req.type == "youtube":
            if not req.video_id:
                raise HTTPException(400, "video_id required for YouTube")
            rag = YouTubeRAG()
            char_count = rag.load(
                req.video_id, 
                transcript_text=req.transcript,
                description=req.description,
                comments=req.comments
            )
            rag_cache[req.session_id] = rag
            return LoadResponse(
                session_id=req.session_id,
                status="ready",
                message=f"Video content loaded and indexed.",
                char_count=char_count,
            )

        elif req.type == "website":
            rag = WebsiteRAG()
            # Use pre-extracted text if provided (faster), else fetch by URL
            if req.text:
                char_count = rag.load_text(req.text, source=req.url or "page")
            elif req.url:
                char_count = rag.load_url(req.url)
            else:
                raise HTTPException(400, "url or text required for website")
            rag_cache[req.session_id] = rag
            return LoadResponse(
                session_id=req.session_id,
                status="ready",
                message=f"Page content loaded and indexed.",
                char_count=char_count,
            )

        else:
            raise HTTPException(400, f"Unknown type: {req.type}")

    except Exception as e:
        logger.error(f"Load error: {e}")
        raise HTTPException(500, str(e))


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Answer a question using the indexed content."""
    rag = rag_cache.get(req.session_id)
    if not rag:
        raise HTTPException(404, "Session not found. Please reload the page.")

    try:
        result = rag.ask(req.question)
        return ChatResponse(answer=result["answer"], sources=result.get("sources", []))
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(500, str(e))


@app.delete("/session/{session_id}")
def clear_session(session_id: str):
    rag_cache.pop(session_id, None)
    return {"status": "cleared"}
