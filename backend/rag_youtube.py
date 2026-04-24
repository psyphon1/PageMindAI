import os
import re
from youtube_transcript_api import YouTubeTranscriptApi
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_groq import ChatGroq
from langchain_community.embeddings.fastembed import FastEmbedEmbeddings
from langchain.chains import ConversationalRetrievalChain
from langchain_core.prompts import PromptTemplate
import logging

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = PromptTemplate(
    input_variables=["context", "question"],
    template="""You are PageMindAI, an expert video analysis assistant.
Use the provided video context to answer the user's question directly and helpfully.

INSTRUCTIONS:
1. Be concise and direct. Answer in 1-3 sentences unless a detailed summary is requested.
2. Use information ONLY from the provided context.
3. Prioritize information from the "TRANSCRIPT" section over the description or comments.
4. Always provide the best possible answer using the available context. Avoid saying "I don't find", "not mentioned", or "cannot determine". If a specific detail is missing, provide a relevant summary of what IS available.
5. Use bullet points only for lists.

Video Context:
{context}

Question: {question}

Answer:""",
)


class YouTubeRAG:
    def __init__(self):
        self.vectorstore = None
        self.qa_chain = None
        self.chat_history = []  # Session-specific history
        self.embeddings = FastEmbedEmbeddings(model_name="BAAI/bge-small-en-v1.5")
        import os
        api_key = os.getenv("GROQ_API_KEY")
        self.llm = ChatGroq(
            model_name="llama-3.3-70b-versatile", 
            temperature=0,
            groq_api_key=api_key
        )

    def load(self, video_id: str, transcript_text: str = None, description: str = None, comments: str = None) -> int:
        """Fetch video content, chunk, embed, and build retrieval chain. Returns char count."""
        if not transcript_text:
            transcript_text = self._fetch_transcript(video_id)
        
        # Clean transcript of any timestamp patterns (e.g., 0:00, [00:00])
        if transcript_text:
            # Strip patterns like 0:00, 12:34, [00:00], (00:00)
            transcript_text = re.sub(r'\[?\d{1,2}:\d{2}\]?|\(?\d{1,2}:\d{2}\)?', '', transcript_text)
            # Strip multiple spaces
            transcript_text = re.sub(r'\s+', ' ', transcript_text).strip()

        full_content = []
        if transcript_text:
            full_content.append(f"TRANSCRIPT:\n{transcript_text}")
        if description:
            full_content.append(f"VIDEO DESCRIPTION:\n{description}")
        if comments:
            full_content.append(f"TOP COMMENTS:\n{comments}")

        if not full_content:
            raise RuntimeError(f"No content available for video {video_id}")
            
        final_text = "\n\n".join(full_content)
        return self._build_chain(final_text, source=f"youtube:{video_id}")

    def _fetch_transcript(self, video_id: str) -> str:
        cookies_path = os.path.join(os.path.dirname(__file__), 'cookies.txt')
        cookies = cookies_path if os.path.exists(cookies_path) else None
        
        try:
            transcript = YouTubeTranscriptApi.get_transcript(video_id, cookies=cookies)
            return " ".join(entry["text"] for entry in transcript)
        except Exception as e:
            logger.warning(f"Server-side transcript fetch failed for {video_id}: {e}")
            return None

    def _build_chain(self, text: str, source: str) -> int:
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=150,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        docs = splitter.create_documents([text], metadatas=[{"source": source}])
        
        self.vectorstore = FAISS.from_documents(docs, self.embeddings)

        self.qa_chain = ConversationalRetrievalChain.from_llm(
            llm=self.llm,
            retriever=self.vectorstore.as_retriever(search_kwargs={"k": 8}),
            combine_docs_chain_kwargs={"prompt": SYSTEM_PROMPT},
            return_source_documents=True,
        )
        return len(text)

    def ask(self, question: str) -> dict:
        if not self.qa_chain:
            raise RuntimeError("Content not loaded yet")
        
        result = self.qa_chain.invoke({
            "question": question,
            "chat_history": self.chat_history
        })
        
        answer = result["answer"]
        # Update history
        self.chat_history.append((question, answer))
        # Keep only last 5 turns to stay within context limits
        if len(self.chat_history) > 5:
            self.chat_history = self.chat_history[-5:]

        sources = list({
            doc.metadata.get("source", "") for doc in result.get("source_documents", [])
        })
        return {"answer": answer, "sources": sources}
