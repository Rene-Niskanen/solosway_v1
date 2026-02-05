"""
Text Cleaning Service for RAG Data Cleaning

Provides utilities to clean chunk text before embedding, removing:
- HTML tags
- Markdown syntax
- OCR commentary
- Boilerplate content
- Formatting artifacts
"""

import re
import unicodedata
from typing import List, Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


class TextCleaningService:
    """Service for cleaning text chunks before embedding."""
    
    def __init__(self):
        pass
    
    def strip_html_tags(self, text: str) -> str:
        """
        Remove all HTML tags from text (aggressive removal).
        
        Args:
            text: Text potentially containing HTML tags
            
        Returns:
            Text with HTML tags removed
        """
        if not text:
            return text
        
        # Remove HTML tags using regex (handles nested tags and self-closing tags)
        # Pattern matches <...> tags, including nested structures
        # This will remove: <table>, <tr>, <td>, <th>, <tbody>, <thead>, etc.
        text = re.sub(r'<[^>]+>', '', text)
        
        # Remove HTML entities (more comprehensive)
        text = re.sub(r'&[a-zA-Z]+;', '', text)  # Named entities like &nbsp;
        text = re.sub(r'&#\d+;', '', text)  # Numeric entities like &#160;
        text = re.sub(r'&#x[0-9a-fA-F]+;', '', text)  # Hex entities like &#xA0;
        text = re.sub(r'&nbsp;', ' ', text)  # Common non-breaking space
        text = re.sub(r'&amp;', '&', text)  # Decode ampersand
        text = re.sub(r'&lt;', '<', text)  # Decode less-than
        text = re.sub(r'&gt;', '>', text)  # Decode greater-than
        text = re.sub(r'&quot;', '"', text)  # Decode quote
        
        return text
    
    def strip_markdown(self, text: str) -> str:
        """
        Remove markdown syntax from text (aggressive removal).
        
        Args:
            text: Text potentially containing markdown
            
        Returns:
            Text with markdown syntax removed
        """
        if not text:
            return text
        
        # Remove markdown headers (# ## ###) - more aggressive
        text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
        # Also remove headers with no space after #
        text = re.sub(r'^#{1,6}(?=\S)', '', text, flags=re.MULTILINE)
        
        # Remove markdown lists (bullet points and numbered)
        text = re.sub(r'^\s*[-*+]\s+', '', text, flags=re.MULTILINE)  # Bullet lists
        text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)  # Numbered lists
        
        # Remove bold/italic markers (handle nested and edge cases)
        # Bold: **text** or __text__
        text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)  # Bold with **
        text = re.sub(r'__([^_]+)__', r'\1', text)  # Bold with __
        # Italic: *text* or _text_ (but be careful not to remove asterisks in math/numbers)
        text = re.sub(r'(?<!\*)\*([^*\n]+?)\*(?!\*)', r'\1', text)  # Italic with *
        text = re.sub(r'(?<!_)_([^_\n]+?)_(?!_)', r'\1', text)  # Italic with _
        
        # Remove horizontal rules (---, ***, ===)
        text = re.sub(r'^[-*={3,}]+$', '', text, flags=re.MULTILINE)
        
        # Remove markdown links [text](url) -> text
        text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
        
        # Remove markdown images ![alt](url) -> alt (or nothing if no alt)
        text = re.sub(r'!\[([^\]]*)\]\([^\)]+\)', r'\1', text)
        
        # Remove inline code `code` -> code
        text = re.sub(r'`([^`]+)`', r'\1', text)
        
        # Remove code blocks ```code``` -> code (or nothing)
        text = re.sub(r'```[^`]*```', '', text, flags=re.DOTALL)
        text = re.sub(r'```.*?```', '', text, flags=re.DOTALL)
        
        # Remove markdown blockquotes (> text)
        text = re.sub(r'^>\s+', '', text, flags=re.MULTILINE)
        
        # Remove markdown strikethrough ~~text~~
        text = re.sub(r'~~([^~]+)~~', r'\1', text)
        
        return text
    
    def remove_ocr_commentary(self, text: str) -> str:
        """
        Remove OCR-generated commentary and image descriptions.
        
        Args:
            text: Text potentially containing OCR commentary
            
        Returns:
            Text with OCR commentary removed
        """
        if not text:
            return text
        
        # Common OCR commentary patterns
        ocr_patterns = [
            r"Here's the information extracted from the image[^\n]*",
            r"Key entities identified[^\n]*",
            r"Information extracted from the image[^\n]*",
            r"Image analysis[^\n]*",
            r"OCR detected[^\n]*",
            r"Text extracted from image[^\n]*",
            r"Image content[^\n]*",
        ]
        
        for pattern in ocr_patterns:
            text = re.sub(pattern, '', text, flags=re.IGNORECASE)
        
        return text
    
    def convert_table_to_text(self, html_table: str) -> str:
        """
        Convert HTML table to plain text format.
        
        Args:
            html_table: HTML table string
            
        Returns:
            Plain text representation of table
        """
        if not html_table:
            return html_table
        
        # First strip HTML tags
        text = self.strip_html_tags(html_table)
        
        # Replace multiple spaces/tabs with single space
        text = re.sub(r'\s+', ' ', text)
        
        # Try to preserve table structure with simple formatting
        # This is a basic implementation - can be enhanced with BeautifulSoup if needed
        lines = text.split('\n')
        cleaned_lines = []
        for line in lines:
            line = line.strip()
            if line:
                cleaned_lines.append(line)
        
        return '\n'.join(cleaned_lines)
    
    def normalize_whitespace(self, text: str) -> str:
        """
        Normalize whitespace: fix line spacing, remove orphan punctuation.
        
        Args:
            text: Text with potentially broken whitespace
            
        Returns:
            Text with normalized whitespace
        """
        if not text:
            return text
        
        # Replace multiple newlines with double newline (paragraph break)
        text = re.sub(r'\n{3,}', '\n\n', text)
        
        # Replace multiple spaces with single space
        text = re.sub(r' +', ' ', text)
        
        # Fix orphan punctuation (punctuation at start of line)
        text = re.sub(r'\n\s*([.,;:!?])', r'\1', text)
        
        # Remove trailing whitespace from lines
        lines = text.split('\n')
        lines = [line.rstrip() for line in lines]
        text = '\n'.join(lines)
        
        # Remove leading/trailing whitespace
        text = text.strip()
        
        return text
    
    def normalize_unicode(self, text: str) -> str:
        """
        Normalize Unicode: UTF-8 normalization, smart quotes.
        
        Args:
            text: Text with potentially non-standard Unicode
            
        Returns:
            Text with normalized Unicode
        """
        if not text:
            return text
        
        # Normalize to NFC (Canonical Composition)
        text = unicodedata.normalize('NFC', text)
        
        # Replace smart quotes with straight quotes
        text = text.replace('\u2018', "'")  # Left single quotation mark
        text = text.replace('\u2019', "'")  # Right single quotation mark
        text = text.replace('\u201C', '"')  # Left double quotation mark
        text = text.replace('\u201D', '"')  # Right double quotation mark
        text = text.replace('\u2013', '-')  # En dash
        text = text.replace('\u2014', '--')  # Em dash
        
        # Replace non-breaking spaces with regular spaces
        text = text.replace('\u00A0', ' ')
        
        return text
    
    def remove_boilerplate(
        self, 
        text: str, 
        boilerplate_lines: Optional[List[Dict[str, Any]]] = None
    ) -> str:
        """
        Remove boilerplate lines from text.
        
        Args:
            text: Text potentially containing boilerplate
            boilerplate_lines: List of boilerplate line dicts with 'line' key
            
        Returns:
            Text with boilerplate lines removed
        """
        if not text or not boilerplate_lines:
            return text
        
        # Extract just the line text from boilerplate_lines
        boilerplate_texts = {bp['line'].strip() for bp in boilerplate_lines if bp.get('line')}
        
        if not boilerplate_texts:
            return text
        
        # Split text into lines
        lines = text.split('\n')
        cleaned_lines = []
        
        for line in lines:
            line_stripped = line.strip()
            # Skip if this line matches any boilerplate line
            if line_stripped not in boilerplate_texts:
                cleaned_lines.append(line)
        
        return '\n'.join(cleaned_lines)
    
    def normalize_sentences(self, text: str) -> str:
        """
        Normalize sentences: ensure complete sentences, fix broken line spacing.
        
        Args:
            text: Text with potentially broken sentences
            
        Returns:
            Text with normalized sentences
        """
        if not text:
            return text
        
        # First normalize Unicode and whitespace
        text = self.normalize_unicode(text)
        text = self.normalize_whitespace(text)
        
        # Fix sentences broken across lines (line break after period but before capital)
        # Pattern: period/newline/capital -> period space capital
        text = re.sub(r'\.\n([A-Z])', r'. \1', text)
        
        # Fix sentences broken across lines (line break after comma but before lowercase)
        # Only fix if it looks like a sentence continuation
        text = re.sub(r',\n([a-z])', r', \1', text)
        
        # Ensure sentences end with punctuation
        # This is optional - may be too aggressive
        # text = re.sub(r'([a-z])\n([A-Z])', r'\1. \2', text)
        
        return text
    
    def clean_chunk_text(
        self, 
        text: str, 
        boilerplate_lines: Optional[List[Dict[str, Any]]] = None
    ) -> str:
        """
        Master cleaning function: applies all cleaning steps in order.
        
        This is the ONLY function that should be used to clean text before embedding.
        
        Args:
            text: Raw chunk text to clean
            boilerplate_lines: Optional list of boilerplate lines to remove
            
        Returns:
            Clean, semantic text ready for embedding
        """
        if not text:
            return text
        
        # Step 1: Remove HTML tags
        text = self.strip_html_tags(text)
        
        # Step 2: Remove markdown syntax
        text = self.strip_markdown(text)
        
        # Step 3: Remove OCR commentary
        text = self.remove_ocr_commentary(text)
        
        # Step 4: Convert tables to plain text (if any HTML tables remain)
        text = self.convert_table_to_text(text)
        
        # Step 5: Remove boilerplate (if provided)
        if boilerplate_lines:
            text = self.remove_boilerplate(text, boilerplate_lines)
        
        # Step 6: Normalize Unicode
        text = self.normalize_unicode(text)
        
        # Step 7: Normalize whitespace
        text = self.normalize_whitespace(text)
        
        # Step 8: Normalize sentences
        text = self.normalize_sentences(text)
        
        return text.strip()