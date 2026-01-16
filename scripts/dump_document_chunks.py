#!/usr/bin/env python3
"""
Utility script to inspect Supabase document_chunks (document_vectors) rows.

Prints chunk_index, page_number, bbox, and a text snippet for troubleshooting
bounding-box highlighting issues.
"""

import argparse
import json
import os
from textwrap import shorten

from dotenv import load_dotenv
from supabase import create_client


def main():
    parser = argparse.ArgumentParser(
        description="Dump chunk_text + bbox for a document from Supabase document_vectors."
    )
    parser.add_argument(
        "--document-id",
        required=True,
        help="Document UUID to inspect (e.g. 91c75576-b96e-4f33-8a35-f6abd6674ded)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=200,
        help="Max characters of chunk text to display (default: 200)",
    )
    args = parser.parse_args()

    load_dotenv()

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not supabase_url or not supabase_key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required.")

    supabase = create_client(supabase_url, supabase_key)
    response = (
        supabase.table("document_vectors")
        .select("chunk_index, page_number, bbox, chunk_text")
        .eq("document_id", args.document_id)
        .order("chunk_index")
        .execute()
    )

    rows = response.data or []
    print(f"📄 Document {args.document_id} has {len(rows)} chunk(s) in document_vectors\n")

    for row in rows:
        chunk_index = row.get("chunk_index")
        page_number = row.get("page_number")
        bbox_raw = row.get("bbox")
        chunk_text = row.get("chunk_text") or ""

        # Bbox may be stored as JSON string
        if isinstance(bbox_raw, str):
            try:
                bbox = json.loads(bbox_raw)
            except json.JSONDecodeError:
                bbox = bbox_raw
        else:
            bbox = bbox_raw

        snippet = shorten(" ".join(chunk_text.split()), width=args.limit, placeholder="…")

        print(f"Chunk {chunk_index} (page {page_number})")
        print(f"  bbox: {bbox}")
        print(f"  text: {snippet}")
        print()


if __name__ == "__main__":
    main()

