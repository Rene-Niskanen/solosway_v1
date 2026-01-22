"""
Structure Extraction Service for RAG Data Cleaning 

Extracts document structure (sections, headings, tables, images) and identifies boilerplate content.
"""

import re 
import hashlib 
import logging
from typing import List, Dict, Optional, Tuple
from collections import Counter

logger = logging.getLogger(__name__)

class StructureExtractionService:
    """Service for extracting document structure and identifying boilerplate content."""

    def __init__(self):
        pass

    def extract_section_hierarchy(self, chunks: List[Dict[str, any]]) -> List[Dict[str, any]]:
        """
        Extract section titles and heading levels from chunks.

        Args:
            chunks: List of chunks with 'content' field

        Returns:
            List of chunk metadata with section hierarchy info added:
            {
                'section_title': str,
                'section_level': int, #1, 2, 3, etc.
                'section_keywords': List[str],
                'has_section_header': bool
            }
        """
        from backend.llm.utils.section_header_detector import detect_section_header

        chunk_metadata_list = []

        for chunk in chunks:
            chunk_text = chunk.get('content', '') or chunk.get('text', '')

            # Detects section header using existing detector
            header_info = detect_section_header(chunk_text)

            if header_info:
                # Extract heading level from section title
                section_level = self._extract_heading_level(chunk_text, header_info.get('section_header', ''))
                
                chunk_meta = {
                    'section_title': header_info.get('section_header', ''),
                    'section_level': section_level,
                    'normalized_header': header_info.get('normalized_header', ''),
                    'section_keywords': header_info.get('section_keywords', []),
                    'has_section_header': True
                }

            else:
                chunk_meta = {
                    'section_title': None,
                    'section_level': None,
                    'has_section_header': False
                }

            chunk_metadata_list.append(chunk_meta)

        return chunk_metadata_list

    def _extract_heading_level(self, chunk_text: str, section_title: str):
        """
        Extract heading level from section title.

        levels:
        1 = Main section title (e.g., "1 Instructions", "10 valuation")
        2 = Subsection (e.g., "1.1 Purpose", "10.1 Market Value")
        3 = Sub_section 

        Args:
            chunk_text: Full chunk text
            section_title: Detected section title

        Returns:
            heading level (1-3, default 1)
        """
        if not section_title:
            return 1
        
        # Pattern 1: Numbered sections (e.g., "10 Valuation" = level 1, "10.1 Market Value" = level 2)
        numbered_match = re.match(r'^(\d+)(?:\.(\d+))?(?:\.(\d+))?', section_title)
        if numbered_match:
            if numbered_match.group(3):
                return 3
            elif numbered_match.group(2):
                return 2
            else:
                return 1
        
        # Pattern 2: check markdown-style headers in chunk text
        lines = chunk_text.split('\n')[:5] # Check the first 5 lines 
        for line in lines:
            if section_title.strip() in line:
                #count leading # for markdown headers
                markdown_match = re.match(r'^(#{1,3})\s+', line)
                if markdown_match:
                    return len(markdown_match.group(1))

        return 1

    def identify_table_boundaries(self, blocks: List[Dict[str, any]]) -> List[Dict[str, any]]:
        """
        Identify table regions from blocks.

        Args:
            blocks: list of block metadata dicts

        Returns:
            List of table boundary markers:
            {
                'type': 'table',
                'bbox': dict,
                'page': int,
                'block_indices': [int, int] # Start the end block indices
            }
        """
        table_boundaries = []

        for i, block in enumerate(blocks):
            if block.get('type') == 'Table':
                bbox = block.get('bbox', {})
                table_boundaries.append({
                    'type': 'table',
                    'bbox': bbox,
                    'page': bbox.get('page') or bbox.get('original_page'),
                    'block_index': i
                })
        
        return table_boundaries

    def identify_image_regions(self, blocks: List[Dict[str, any]]) -> List[Dict[str, any]]:
        """
        Identify image regions from blocks.

        Args:
            blocks: List of block metadata dicts

        Return: 
            List of image region markers:
            {
                'type': 'image',
                'bbox': {...},
                'page': int,
                'image_url': str (optional)
            }
        """
        image_regions = []

        for block in blocks:
            if block.get('type') in ['Figure', 'Image'] or block.get('image_url'):
                bbox = block.get('bbox', {})
                image_regions.append({
                    'type': 'image',
                    'bbox': bbox,
                    'page': bbox.get('page') or bbox.get('original_page'),
                    'image_url': block.get('image_url')
                })
        
        return image_regions

    def identify_boilerplate(
        self,
        document_text: str,
        chunks: List[Dict[str, any]],
        threashold_percent: float = 25.0
    ) -> Dict[str, any]:
        """
        Identify boilerplate content (headers, footers, repeated disclamers).

        Stratergy:
        1. Hash each line 
        2. Count frequency across document
        3. mark lines appearing in >threashold_percent% of chunks as boilerplate metadata

        Args:
            document_text: Full document text
            chunks: List of chunk dicts
            threashold_percent: Percentage threashold (default 25%)

        Returns: 
            Dict with boilerplate info:
            {
                'boilerplate_lines': [
                    {
                        'line': str,
                        'hash': str,
                        'frequency': int,
                        'frequency_percent': float,
                        'type': 'header' | 'footer' | 'disclaimer'
                    }
                ]
                'common_header': List[str],
                'common_footer': List[str]
            }
        """
        if not document_text or not chunks:
            return {
                'boilerplate_lines': [],
                'common_header': [],
                'common_footer': []
            }

        
        # split document into lines
        all_lines = document_text.split('\n')

        # hash each line and count frequency across chunks
        line_hashes = {}
        line_frequency = Counter()

        for line in all_lines:
            line_stripped = line.strip()
            if not line_stripped or len(line_stripped) < 3:
                continue
        
            line_hash = hashlib.sha256(line_stripped.encode('utf-8')).hexdigest()
            line_hashes[line_hash] = line_stripped
            line_frequency[line_hash] += 1

        
        # count how many chunks contain each line
        chunk_count = len(chunks)
        line_chunk_frequency = Counter()

        for chunk in chunks:
            chunk_text = chunk.get('content', '') or chunk.get('text', '')
            chunk_lines = chunk_text.split('\n')
            seen_hashes = set()

            for line in chunk_lines:
                line_stripped = line.strip()
                if not line_stripped or len(line_stripped) < 3:
                    continue

                line_hash = hashlib.sha256(line_stripped.encode('utf-8')).hexdigest()
                if line_hash in line_hashes:
                    line_chunk_frequency[line_hash] += 1
                    seen_hashes.add(line_hash)

                
        # identify boilerplate lines (appearing in >threashold_percent% of chunks)
        boilerplate_lines = []
        threashold_count = max(1, int(chunk_count * (threashold_percent / 100.0)))
        
        for line_hash, chunk_freq in line_chunk_frequency.items():
            if chunk_freq >= threashold_count:
                line_text = line_hashes.get(line_hash, '')
                frequency_percent = (chunk_freq / chunk_count) * 100.0

                # Classify type based on possition and content
                line_type = self._classify_boilerplate_type(line_text, document_text)

                boilerplate_lines.append({
                    'line': line_text,
                    'hash': line_hash,
                    'frequency': chunk_freq,
                    'frequency_percent': frequency_percent,
                    'type': line_type
                })

        # separated common headers and footers
        common_header = [
            bp['line'] for bp in boilerplate_lines if bp['type'] == 'header'
        ]
        common_footer = [
            bp['line'] for bp in boilerplate_lines if bp['type'] == 'footer'
        ]

        logger.info(
            f"Identified {len(boilerplate_lines)} boilerplate lines "
            f"({len(common_header)} headers, {len(common_footer)} footers)"
        )

        return {
            'boilerplate_lines': boilerplate_lines,
            'common_header': common_header,
            'common_footer': common_footer
        }

    def _classify_boilerplate_type(self, line: str, document_text: str) -> str:
        """
        Classify boilerplate line as header, footer, or disclaimer.

        Args:
            line: The line text
            document_text: Full document text

        Returns:
            'header' | 'footer' | 'disclaimer'
        """
        line_lower = line.lower()

        # footer indicators
        footer_keywords = ['page', 'tel:', 'email:', 'www.', 'address:', 'copyright', '©']
        if any(keyword in line_lower for keyword in footer_keywords):
            return 'footer'

        # header indicators
        header_keywords = ['company', 'ltd', 'limited', 'group', 'international']
        if any(keyword in line_lower for keyword in header_keywords):
            return 'header'

        # Disclamer indicators
        disclaimer_keywords = ['disclaimer', 'confidential', 'proprietary', 'not for distribution']
        if any(keyword in line_lower for keyword in disclaimer_keywords):
            return 'disclaimer'

        # check positoin in document 
        lines = document_text.split('\n')
        try:
            line_index = lines.index(line)
            total_lines = len(lines)
            position_ratio = line_index / total_lines if total_lines > 0 else 0.5

            if position_ratio < 0.1:
                return 'header'
            elif position_ratio > 0.9:
                return 'footer'
        except ValueError:
            pass 

        # default: disclaimer
        return 'disclaimer'
        



