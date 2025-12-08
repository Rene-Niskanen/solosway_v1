"""
Local Embedding Server using Sentence Transformers (CPU-based).

This FastAPI server hosts embedding models (BGE, GTE, E5) on CPU,
providing a local alternative to OpenAI embeddings for cost savings.

Usage:
    # Development
    uvicorn backend.services.embedding_server:app --host 0.0.0.0 --port 5002 --reload
    
    # Production
    gunicorn -w 4 -k uvicorn.workers.UvicornWorker backend.services.embedding_server:app --bind 0.0.0.0:5002
"""

from fastapi import FastAPI, HTTPException
from sentence_transformers import SentenceTransformer
import logging
import os
import re
import json
from typing import List, Dict, Any, Optional
import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Local Embedding Server",
    description="CPU-based embedding service using Sentence Transformers",
    version="1.0.0"
)

# CPU-friendly embedding model
# Options: 
# - "BAAI/bge-small-en-v1.5" (384d) - Best for English, verified working
# - "sentence-transformers/all-MiniLM-L6-v2" (384d) - Very popular, fast
# - "intfloat/e5-small-v2" (384d) - Good general purpose
# - "sentence-transformers/all-mpnet-base-v2" (768d) - Higher quality, slower
MODEL_NAME = os.environ.get("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
DEVICE = os.environ.get("EMBEDDING_DEVICE", "cpu")  # "cpu" or "cuda"

logger.info(f"Loading embedding model: {MODEL_NAME} on {DEVICE}")
try:
    model = SentenceTransformer(MODEL_NAME, device=DEVICE)
    embedding_dimension = model.get_sentence_embedding_dimension()
    logger.info(f"Embedding model loaded successfully")
    logger.info(f"   Model: {MODEL_NAME}")
    logger.info(f"   Device: {DEVICE}")
    logger.info(f"   Dimensions: {embedding_dimension}")
except Exception as e:
    logger.error(f"Failed to load embedding model: {e}")
    raise


@app.post("/embed")
async def embed(payload: dict):
    """
    Embed a list of texts.
    
    Request:
        {
            "texts": ["text1", "text2", ...]
        }
    
    Response:
        {
            "embeddings": [[0.1, 0.2, ...], [0.3, 0.4, ...], ...],
            "dimensions": 384,
            "count": 2,
            "model": "BAAI/bge-small-en-v1.5"
        }
    """
    texts = payload.get("texts", [])
    if not texts:
        raise HTTPException(status_code=400, detail="No texts provided")
    
    if not isinstance(texts, list):
        raise HTTPException(status_code=400, detail="texts must be a list")
    
    if len(texts) == 0:
        raise HTTPException(status_code=400, detail="texts list cannot be empty")
    
    try:
        # Generate embeddings (batch processing for efficiency)
        embeddings = model.encode(
            texts, 
            batch_size=32, 
            show_progress_bar=False,
            normalize_embeddings=True,  # Normalize for cosine similarity
            convert_to_numpy=True
        )
        
        # Convert numpy arrays to lists for JSON serialization
        return {
            "embeddings": embeddings.tolist(),
            "dimensions": len(embeddings[0]) if len(embeddings) > 0 else 0,
            "count": len(embeddings),
            "model": MODEL_NAME
        }
    except Exception as e:
        logger.error(f"Embedding error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    """Health check endpoint."""
    try:
        return {
            "status": "healthy", 
            "model": MODEL_NAME,
            "device": DEVICE,
            "dimensions": embedding_dimension
        }
    except NameError:
        # Model not loaded yet
        return {
            "status": "error",
            "model": MODEL_NAME,
            "device": DEVICE,
            "error": "Model not loaded"
        }


@app.post("/context/document")
async def generate_document_context(payload: dict):
    """
    Generate document-level summary/context using extractive summarization.
    
    Uses semantic sentence extraction: embeds sentences, finds most representative ones.
    
    Request:
        {
            "text": "full document text...",
            "metadata": {
                "classification_type": "valuation_report",
                "original_filename": "property.pdf"
            }
        }
    
    Response:
        {
            "summary": "2-3 sentence summary",
            "top_entities": ["address", "price", "date"],
            "document_tags": ["valuation", "inspection"],
            "subject_property_address": "...",
            "key_dates": ["2024-01-15"],
            "key_values": {"price": "£450,000", "size": "250 sqm"},
            "party_names": {
                "valuer": "John Smith MRICS" or null,
                "seller": "Jane Doe" or null,
                "buyer": "Bob Johnson" or null,
                "estate_agent": "Savills" or null
            }
        }
    """
    try:
        text = payload.get("text", "")
        metadata = payload.get("metadata", {})
        
        if not text:
            raise HTTPException(status_code=400, detail="No text provided")
        
        # Limit text length for processing
        max_chars = 50000
        if len(text) > max_chars:
            text = text[:max_chars] + "\n\n[... document truncated ...]"
        
        # Extract summary using semantic sentence extraction
        summary = _extract_document_summary(text, metadata)
        
        # Extract structured information using regex patterns
        entities = _extract_entities(text)
        key_values = _extract_key_values(text)
        key_dates = _extract_dates(text)
        party_names = _extract_party_names(text)
        address = _extract_property_address(text)
        
        return {
            "summary": summary,
            "top_entities": entities,
            "document_tags": [metadata.get("classification_type", "document")],
            "subject_property_address": address,
            "key_dates": key_dates[:5],  # Limit to 5 dates
            "key_values": key_values,
            "party_names": party_names
        }
    except Exception as e:
        logger.error(f"Document context generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/context/batch")
async def generate_chunk_contexts_batch(payload: dict):
    """
    Generate contexts for multiple chunks in batch using semantic summarization.
    
    Request:
        {
            "chunks": ["chunk1 text...", "chunk2 text...", ...],
            "metadata": {
                "classification_type": "valuation_report",
                "original_filename": "property.pdf"
            }
        }
    
    Response:
        {
            "contexts": ["context1", "context2", ...],
            "count": 2
        }
    """
    try:
        chunks = payload.get("chunks", [])
        metadata = payload.get("metadata", {})
        
        if not chunks:
            raise HTTPException(status_code=400, detail="No chunks provided")
        
        if not isinstance(chunks, list):
            raise HTTPException(status_code=400, detail="chunks must be a list")
        
        # Generate contexts for each chunk
        contexts = []
        for chunk in chunks:
            if not chunk or not chunk.strip():
                contexts.append("")
                continue
            
            # Generate concise context using semantic extraction
            context = _generate_chunk_context(chunk, metadata)
            contexts.append(context)
        
        return {
            "contexts": contexts,
            "count": len(contexts)
        }
    except Exception as e:
        logger.error(f"Chunk context batch generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _extract_document_summary(text: str, metadata: Dict[str, Any]) -> str:
    """
    Extract 2-3 sentence summary using semantic sentence extraction.
    
    Strategy:
    1. Split text into sentences
    2. Embed all sentences
    3. Find centroid (average embedding)
    4. Select 2-3 sentences closest to centroid
    """
    # Split into sentences
    sentences = _split_into_sentences(text)
    
    if len(sentences) <= 3:
        return " ".join(sentences)
    
    # Limit to reasonable number for processing
    max_sentences = 100
    if len(sentences) > max_sentences:
        sentences = sentences[:max_sentences]
    
    try:
        # Embed all sentences
        sentence_embeddings = model.encode(
            sentences,
            batch_size=32,
            show_progress_bar=False,
            normalize_embeddings=True,
            convert_to_numpy=True
        )
        
        # Calculate centroid (average embedding)
        centroid = np.mean(sentence_embeddings, axis=0)
        centroid = centroid / np.linalg.norm(centroid)  # Normalize
        
        # Find 2-3 sentences closest to centroid
        similarities = np.dot(sentence_embeddings, centroid)
        top_indices = np.argsort(similarities)[-3:][::-1]  # Top 3, highest first
        
        # Select 2-3 sentences (prefer longer, more informative ones)
        selected_sentences = []
        for idx in top_indices:
            if len(sentences[idx].strip()) > 20:  # Filter very short sentences
                selected_sentences.append(sentences[idx])
                if len(selected_sentences) >= 3:
                    break
        
        # If we have metadata, add context
        doc_type = metadata.get("classification_type", "")
        if doc_type:
            summary = f"This {doc_type.replace('_', ' ')} document contains: " + " ".join(selected_sentences[:2])
        else:
            summary = " ".join(selected_sentences[:2])
        
        return summary[:500]  # Limit summary length
        
    except Exception as e:
        logger.warning(f"Semantic extraction failed: {e}, using simple extraction")
        # Fallback: use first few sentences
        return " ".join(sentences[:3])[:500]


def _generate_chunk_context(chunk: str, metadata: Dict[str, Any]) -> str:
    """
    Generate concise context for a chunk (50-100 tokens).
    
    Strategy:
    1. Extract key sentences from chunk
    2. Add document type context if available
    3. Keep it concise
    """
    # Split into sentences
    sentences = _split_into_sentences(chunk)
    
    if len(sentences) <= 2:
        # Short chunk, use as-is with minimal context
        doc_type = metadata.get("classification_type", "")
        if doc_type:
            return f"From {doc_type.replace('_', ' ')}: {chunk[:200]}"
        return chunk[:200]
    
    # For longer chunks, extract key sentences
    try:
        # Embed sentences
        sentence_embeddings = model.encode(
            sentences,
            batch_size=32,
            show_progress_bar=False,
            normalize_embeddings=True,
            convert_to_numpy=True
        )
        
        # Find sentence closest to centroid (most representative)
        centroid = np.mean(sentence_embeddings, axis=0)
        centroid = centroid / np.linalg.norm(centroid)
        similarities = np.dot(sentence_embeddings, centroid)
        top_idx = np.argmax(similarities)
        
        key_sentence = sentences[top_idx]
        
        # Add document context
        doc_type = metadata.get("classification_type", "")
        if doc_type:
            context = f"{doc_type.replace('_', ' ')} section: {key_sentence}"
        else:
            context = key_sentence
        
        return context[:200]  # Keep concise
        
    except Exception as e:
        logger.warning(f"Chunk context generation failed: {e}, using simple extraction")
        # Fallback: use first sentence
        return sentences[0][:200] if sentences else chunk[:200]


def _split_into_sentences(text: str) -> List[str]:
    """Split text into sentences using regex."""
    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    
    # Split by sentence endings
    sentences = re.split(r'[.!?]+\s+', text)
    
    # Filter out very short fragments
    sentences = [s.strip() for s in sentences if len(s.strip()) > 10]
    
    return sentences


def _extract_entities(text: str) -> List[str]:
    """Extract key entities (addresses, prices, etc.)"""
    entities = []
    
    # Extract addresses
    address_patterns = [
        r'\b\d+[,\s]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Road|Street|Avenue|Lane|Drive|Close|Way|Place|Court)\b',
        r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Road|Street|Avenue|Lane|Drive)\s+\d+\b'
    ]
    for pattern in address_patterns:
        matches = re.findall(pattern, text)
        entities.extend(matches[:3])  # Limit to 3 addresses
    
    # Extract prices
    price_patterns = [
        r'[£$€]\s*[\d,]+(?:\.[\d]{2})?',
        r'[\d,]+\s*(?:KES|USD|GBP|EUR)',
    ]
    for pattern in price_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        entities.extend(matches[:2])  # Limit to 2 prices
    
    return list(set(entities))[:10]  # Deduplicate and limit


def _extract_key_values(text: str) -> Dict[str, str]:
    """Extract key-value pairs (price, size, bedrooms, etc.)"""
    key_values = {}
    
    # Extract price
    price_patterns = [
        r'[£$€]\s*([\d,]+(?:\.[\d]{2})?)',
        r'([\d,]+\s*(?:KES|USD|GBP|EUR))',
    ]
    for pattern in price_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            key_values["price"] = match.group(0)
            break
    
    # Extract size/area
    size_patterns = [
        r'(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|square\s+feet|sqft)',
        r'(\d+(?:\.\d+)?)\s*(?:sqm|square\s+meters)',
    ]
    for pattern in size_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            key_values["size"] = match.group(0)
            break
    
    # Extract bedrooms
    bed_match = re.search(r'(\d+)\s*(?:bed(?:room)?s?|br\b|bd\b)', text, re.IGNORECASE)
    if bed_match:
        key_values["bedrooms"] = bed_match.group(1)
    
    # Extract bathrooms
    bath_match = re.search(r'(\d+)\s*(?:bath(?:room)?s?|ba\b)', text, re.IGNORECASE)
    if bath_match:
        key_values["bathrooms"] = bath_match.group(1)
    
    return key_values


def _extract_dates(text: str) -> List[str]:
    """Extract dates from text"""
    date_patterns = [
        r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b',
        r'\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{2,4}\b',
    ]
    dates = []
    for pattern in date_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        dates.extend(matches)
    
    return list(set(dates))  # Deduplicate


def _extract_party_names(text: str) -> Dict[str, Optional[str]]:
    """Extract party names (valuer, seller, buyer, estate agent)"""
    party_names = {
        "valuer": None,
        "seller": None,
        "buyer": None,
        "estate_agent": None
    }
    
    # Extract valuer (look for MRICS, FRICS, "valued by", "inspected by")
    valuer_patterns = [
        r'(?:valued|inspected|conducted)\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*(?:MRICS|FRICS)?)',
        r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:MRICS|FRICS))',
    ]
    for pattern in valuer_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            party_names["valuer"] = match.group(1).strip()
            break
    
    # Extract estate agent (common agency names)
    agent_patterns = [
        r'(?:estate\s+agent|letting\s+agent|marketing\s+agent)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)',
        r'\b(Savills|Knight\s+Frank|Rightmove|Zoopla|Foxtons|Winkworth)\b',
    ]
    for pattern in agent_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            party_names["estate_agent"] = match.group(1).strip()
            break
    
    # Extract seller/buyer (less reliable, but try)
    seller_match = re.search(r'(?:seller|vendor)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)', text, re.IGNORECASE)
    if seller_match:
        party_names["seller"] = seller_match.group(1).strip()
    
    buyer_match = re.search(r'(?:buyer|purchaser)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)', text, re.IGNORECASE)
    if buyer_match:
        party_names["buyer"] = buyer_match.group(1).strip()
    
    return party_names


def _extract_property_address(text: str) -> Optional[str]:
    """Extract primary property address"""
    address_patterns = [
        r'\b\d+[,\s]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Road|Street|Avenue|Lane|Drive|Close|Way|Place|Court)\b',
        r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Road|Street|Avenue|Lane|Drive)\s+\d+\b',
    ]
    for pattern in address_patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(0)
    return None


@app.get("/")
async def root():
    """Root endpoint with server info."""
    try:
        dim = embedding_dimension
    except NameError:
        dim = "unknown"
    
    return {
        "service": "Local Embedding & Context Server",
        "model": MODEL_NAME,
        "device": DEVICE,
        "dimensions": dim,
        "endpoints": {
            "embed": "/embed (POST)",
            "context/document": "/context/document (POST)",
            "context/batch": "/context/batch (POST)",
            "health": "/health (GET)"
        }
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("EMBEDDING_SERVER_PORT", 5002))
    uvicorn.run(app, host="0.0.0.0", port=port)

