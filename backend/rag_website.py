import requests
from bs4 import BeautifulSoup
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_groq import ChatGroq
from langchain_community.embeddings.fastembed import FastEmbedEmbeddings
from langchain.chains import ConversationalRetrievalChain
from langchain_core.prompts import PromptTemplate
import logging

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

SYSTEM_PROMPT = PromptTemplate(
    input_variables=["context", "question"],
    template="""You are PageMindAI, an expert webpage analysis assistant.
Use the provided webpage content to answer the user's question directly and helpfully.

INSTRUCTIONS:
1. Be concise and direct. Answer in 1-3 sentences unless a detailed summary is requested.
2. Use information ONLY from the provided context.
3. Always provide the best possible answer using the available context. Avoid saying "I don't find", "not mentioned", or "cannot determine". If a specific detail is missing, provide a relevant summary of what IS available.
4. Use bullet points only for lists.

Page Content:
{context}

Question: {question}

Answer:""",
)


class WebsiteRAG:
    def __init__(self):
        self.vectorstore = None
        self.qa_chain = None
        self.chat_history = []  # Session-specific history
        self.embeddings = FastEmbedEmbeddings(model_name="BAAI/bge-small-en-v1.5")
        import os
        api_key = os.getenv("GROQ_API_KEY")
        self.llm = ChatGroq(
            model_name="llama-3.1-8b-instant", 
            temperature=0,
            groq_api_key=api_key
        )

    def load_url(self, url: str) -> int:
        """Fetch, parse, and index a URL. Returns char count."""
        text = self._scrape(url)
        return self._build_chain(text, source=url)

    def load_text(self, text: str, source: str = "page") -> int:
        """Index pre-extracted text (sent from content.js). Returns char count."""
        cleaned = self._clean_text(text)
        return self._build_chain(cleaned, source=source)

    def _scrape(self, url: str) -> str:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
        except requests.RequestException as e:
            raise RuntimeError(f"Failed to fetch {url}: {e}")

        soup = BeautifulSoup(resp.text, "html.parser")

        # Remove noise elements
        for tag in soup(["script", "style", "nav", "footer", "header",
                         "aside", "form", "noscript", "iframe"]):
            tag.decompose()

        # Prefer semantic content containers
        for selector in ["article", "main", '[role="main"]', ".post-content",
                         ".article-body", ".entry-content", "#content"]:
            el = soup.select_one(selector)
            if el:
                return self._clean_text(el.get_text(separator="\n"))

        # Fallback: full body
        return self._clean_text(soup.body.get_text(separator="\n") if soup.body else "")

    @staticmethod
    def _clean_text(text: str) -> str:
        lines = [line.strip() for line in text.splitlines()]
        lines = [line for line in lines if len(line) > 20]  # drop short noise lines
        return "\n".join(lines)

    def _build_chain(self, text: str, source: str) -> int:
        if len(text) < 100:
            raise RuntimeError("Extracted text is too short — page may require JS rendering")

        # Truncate very large pages to stay within embedding limits
        text = text[:60_000]

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
        # Keep only last 5 turns
        if len(self.chat_history) > 5:
            self.chat_history = self.chat_history[-5:]

        sources = list({
            doc.metadata.get("source", "") for doc in result.get("source_documents", [])
        })
        return {"answer": answer, "sources": sources}
