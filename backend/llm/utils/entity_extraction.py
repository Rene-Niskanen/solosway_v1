"""
Entity extraction for entity-gated document retrieval.

Provides get_entity_gate_phrases(query) which returns phrases that must appear
in a document's filename or summary when the user asks about a specific entity
(e.g. "Banda Lane"). When KeyBERT is enabled (default), uses it first to extract
search-relevant keyphrases (e.g. "stablecoin bill") and skips conversational
words (e.g. "please"). Fallback: spaCy NER, alias expansion, then phrase
heuristic when NER finds nothing.

Config: backend/llm/config/entity_gate_config.json (optional).
Keys: use_keybert (bool), keybert_top_n (int), keybert_ngram_range ([int,int]),
      generic_terms, stopwords, entity_labels.
"""

from typing import List, Dict, Set, Tuple, Any
import logging
import os
import json

logger = logging.getLogger(__name__)

# Lazy-loaded spaCy model
_nlp = None

# KeyBERT: lazy-loaded model; None = not tried yet, False = unavailable
_keybert_model: Any = None
_keybert_unavailable = False

# Defaults (overridden by entity_gate_config.json if present)
_DEFAULT_ENTITY_LABELS: Set[str] = {"GPE", "FAC", "LOC", "ORG", "PERSON", "PRODUCT"}
_DEFAULT_GENERIC_TERMS: Set[str] = {
    "break", "options", "lease", "tenancy", "agreement", "deposit", "notice", "termination",
    "months", "written", "party", "parties", "tenant", "landlord", "rent", "payment", "pay",
    "covenant", "covenants", "premises", "property", "structure", "rates", "maintenance",
    "required", "provide", "forfeit", "initial", "renewable", "document", "documents",
    "details", "information", "value", "valuation", "offer", "letter", "sale", "buying",
}
_DEFAULT_STOPWORDS: Set[str] = {
    "what", "how", "when", "where", "which", "who", "the", "a", "an", "is", "are",
    "in", "on", "at", "to", "for", "of", "or", "and", "required", "deposit", "upfront", "payment",
}

# Loaded from config (or defaults); use getters so tests and callers see current values
_entity_labels: Set[str] = set()
_generic_terms: Set[str] = set()
_stopwords: Set[str] = set()
_config_loaded = False
_use_keybert = True
_keybert_top_n = 5
_keybert_ngram_range: Tuple[int, int] = (1, 3)

# In-memory alias map: canonical entity -> list of alternate names (all normalized to lowercase in use)
# Can be extended by loading from backend/llm/config/entity_aliases.json if present.
_ALIAS_MAP: Dict[str, List[str]] = {}


def _get_config_dir() -> str:
    return os.path.join(os.path.dirname(__file__), "..", "config")


def _load_entity_gate_config() -> None:
    """Load generic_terms, stopwords, entity_labels, KeyBERT options from optional entity_gate_config.json.

    Optional file: backend/llm/config/entity_gate_config.json
    Format: {"generic_terms": [...], "stopwords": [...], "entity_labels": [...],
             "use_keybert": true, "keybert_top_n": 5, "keybert_ngram_range": [1, 3]}
    Any key missing uses in-code defaults.
    """
    global _entity_labels, _generic_terms, _stopwords, _config_loaded
    global _use_keybert, _keybert_top_n, _keybert_ngram_range
    if _config_loaded:
        return
    _config_loaded = True
    _entity_labels = set(_DEFAULT_ENTITY_LABELS)
    _generic_terms = set(_DEFAULT_GENERIC_TERMS)
    _stopwords = set(_DEFAULT_STOPWORDS)
    path = os.path.join(_get_config_dir(), "entity_gate_config.json")
    if not os.path.isfile(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return
        if "entity_labels" in data and isinstance(data["entity_labels"], list):
            _entity_labels = {str(x).strip().upper() for x in data["entity_labels"] if x}
        if "generic_terms" in data and isinstance(data["generic_terms"], list):
            _generic_terms = {str(x).strip().lower() for x in data["generic_terms"] if x}
        if "stopwords" in data and isinstance(data["stopwords"], list):
            _stopwords = {str(x).strip().lower() for x in data["stopwords"] if x}
        if "use_keybert" in data and isinstance(data["use_keybert"], bool):
            _use_keybert = data["use_keybert"]
        if "keybert_top_n" in data and isinstance(data["keybert_top_n"], int) and data["keybert_top_n"] > 0:
            _keybert_top_n = min(data["keybert_top_n"], 20)
        if "keybert_ngram_range" in data and isinstance(data["keybert_ngram_range"], list) and len(data["keybert_ngram_range"]) == 2:
            lo, hi = int(data["keybert_ngram_range"][0]), int(data["keybert_ngram_range"][1])
            if 1 <= lo <= hi <= 5:
                _keybert_ngram_range = (lo, hi)
        logger.debug("Loaded entity_gate_config from %s", path)
    except Exception as e:
        logger.debug("Could not load entity_gate_config.json: %s", e)


# Public read-only access (after config load)
def get_entity_labels() -> Set[str]:
    _load_entity_gate_config()
    return set(_entity_labels)


def get_generic_terms() -> Set[str]:
    _load_entity_gate_config()
    return set(_generic_terms)


def get_stopwords() -> Set[str]:
    _load_entity_gate_config()
    return set(_stopwords)


# Backward compatibility: defaults for code/tests that import these; runtime uses get_*()
ENTITY_LABELS = _DEFAULT_ENTITY_LABELS
GENERIC_TERMS = _DEFAULT_GENERIC_TERMS
_STOPWORDS = _DEFAULT_STOPWORDS


def _load_alias_map() -> Dict[str, List[str]]:
    """Load alias map from optional JSON file; return in-memory map merged with file."""
    global _ALIAS_MAP
    out = dict(_ALIAS_MAP)
    try:
        path = os.path.join(_get_config_dir(), "entity_aliases.json")
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                file_aliases = json.load(f)
            if isinstance(file_aliases, dict):
                for canonical, aliases in file_aliases.items():
                    if isinstance(aliases, list):
                        out[canonical.strip()] = [a.strip() for a in aliases if a and isinstance(a, str)]
                    elif isinstance(aliases, str):
                        out[canonical.strip()] = [aliases.strip()]
    except Exception as e:
        logger.debug("Could not load entity_aliases.json: %s", e)
    return out


def _get_nlp():
    """Lazy-load spaCy English model."""
    global _nlp
    if _nlp is not None:
        return _nlp
    try:
        import spacy  # type: ignore[import-untyped]
        _nlp = spacy.load("en_core_web_sm")
        return _nlp
    except Exception as e:
        logger.warning("spaCy model not available (run: python -m spacy download en_core_web_sm): %s", e)
        return None


def _get_keybert_model():
    """Lazy-load KeyBERT model. Returns None if unavailable."""
    global _keybert_model, _keybert_unavailable
    if _keybert_unavailable:
        return None
    if _keybert_model is not None:
        return _keybert_model
    try:
        from keybert import KeyBERT  # type: ignore[import-untyped]
        _keybert_model = KeyBERT()
        return _keybert_model
    except Exception as e:
        logger.warning("KeyBERT not available: %s", e)
        _keybert_unavailable = True
        return None


def _get_keybert_phrases(query: str) -> List[str]:
    """Extract keyphrases from query using KeyBERT. Returns lowercase list; empty on failure."""
    _load_entity_gate_config()
    model = _get_keybert_model()
    if model is None:
        return []
    try:
        keywords = model.extract_keywords(
            query,
            keyphrase_ngram_range=_keybert_ngram_range,
            top_n=_keybert_top_n,
            use_maxsum=False,
        )
        phrases = [str(phrase).strip().lower() for phrase, _ in keywords if phrase and str(phrase).strip()]
        return [p for p in phrases if len(p) >= 2]
    except Exception as e:
        logger.debug("KeyBERT extract_keywords failed: %s", e)
        return []


def _extract_entities_ner(query: str) -> List[str]:
    """Run NER on query and return normalized entity strings (lowercase)."""
    nlp = _get_nlp()
    if nlp is None:
        return []
    try:
        doc = nlp(query)
        entities = []
        for ent in doc.ents:
            if ent.label_ in get_entity_labels() and ent.text.strip():
                entities.append(ent.text.strip().lower())
        return list(dict.fromkeys(entities))  # preserve order, dedupe
    except Exception as e:
        logger.debug("NER failed: %s", e)
        return []


def _expand_with_aliases(entities: List[str]) -> List[str]:
    """Expand entity list with aliases from the alias map. All returned strings are lowercase."""
    alias_map = _load_alias_map()
    expanded = []
    for e in entities:
        el = e.lower()
        if el not in expanded:
            expanded.append(el)
        for canonical, aliases in alias_map.items():
            if canonical.lower() == el:
                for a in aliases:
                    al = a.lower()
                    if al and al not in expanded:
                        expanded.append(al)
            # Also check if entity is an alias of some canonical
            for a in aliases:
                if a.lower() == el and canonical.lower() not in expanded:
                    expanded.append(canonical.lower())
    return expanded


def _phrase_heuristic_fallback(query: str) -> List[str]:
    """Fallback: 2–3 word sliding window, drop phrases that start with or contain stopwords, then filter by GENERIC_TERMS."""
    query_lower = query.lower().strip()
    words = [w for w in query_lower.split() if w]
    phrases = set()
    for i in range(len(words)):
        for n in (2, 3):
            if i + n <= len(words):
                phrases.add(" ".join(words[i : i + n]))
    stopwords = get_stopwords()
    generic_terms = get_generic_terms()
    # Exclude phrases that start with a stopword, contain any stopword (e.g. "please"), or are too short
    entity_phrases = [
        p for p in phrases
        if p.split()[0] not in stopwords
        and not any(w in stopwords for w in p.split())
        and len(p) >= 5
    ]
    # Exclude phrases that are entirely generic terms
    gate_phrases = [
        p for p in entity_phrases
        if not all(w in generic_terms for w in p.split())
    ]
    return gate_phrases


def get_entity_gate_phrases(query: str) -> List[str]:
    """
    Return list of phrases that must appear in a document (filename or summary) for entity gating.

    When KeyBERT is enabled (config use_keybert=true): uses KeyBERT first to get search-relevant
    keyphrases (e.g. "stablecoin bill") and skips conversational words (e.g. "please").
    Fallback: spaCy NER + alias expansion, then phrase heuristic only when spaCy is available.

    Returns:
        List of lowercase strings to require in filename/summary (e.g. ["banda lane", "stablecoin bill"]).
    """
    if not query or not query.strip():
        return []
    _load_entity_gate_config()
    if _use_keybert:
        phrases = _get_keybert_phrases(query)
        if phrases:
            logger.debug("Entity gate phrases from KeyBERT: %s", phrases[:5])
            return phrases
        logger.debug("KeyBERT returned no phrases; falling back to NER/heuristic")
    entities = _extract_entities_ner(query)
    if entities:
        expanded = _expand_with_aliases(entities)
        if expanded:
            return expanded
    if _get_nlp() is None:
        return []
    return _phrase_heuristic_fallback(query)


def get_title_from_query(query: str, max_length: int = 50) -> str:
    """
    Generate a short title from the user query using KeyBERT keyphrases (e.g. for chat names).
    Returns the top keyphrase, title-cased and truncated. Returns "" if KeyBERT unavailable or
    returns no phrases, so the caller can use a heuristic fallback.
    """
    if not query or not query.strip():
        return ""
    _load_entity_gate_config()
    if not _use_keybert:
        return ""
    phrases = _get_keybert_phrases(query)
    if not phrases:
        return ""
    # Use first phrase; optionally add second if short and total length allows
    first = phrases[0].strip()
    if not first:
        return ""
    title = first.title()
    if len(phrases) > 1 and phrases[1].strip() and len(title) + 1 + len(phrases[1]) <= max_length:
        title = title + " " + phrases[1].strip().title()
    return title[:max_length].strip() if len(title) > max_length else title.strip()
