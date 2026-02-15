#!/usr/bin/env python3
"""
List actual document filenames (and optional addresses) from the Supabase documents table.
Use this to populate TEST_QUERIES.md with real data from your database.

Usage:
    python scripts/list_document_filenames.py
    python scripts/list_document_filenames.py --with-addresses
"""

import argparse
import json
import os
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
load_dotenv(project_root / ".env")


def main():
    parser = argparse.ArgumentParser(description="List document filenames from Supabase")
    parser.add_argument("--with-addresses", action="store_true", help="Extract addresses from document_summary")
    parser.add_argument("--limit", type=int, default=200, help="Max documents to fetch (default 200)")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("SUPABASE_KEY")
    )

    if not url or not key:
        print("❌ Missing SUPABASE_URL or SUPABASE_*_KEY in .env")
        sys.exit(1)

    from supabase import create_client
    supabase = create_client(url, key)

    columns = "id, original_filename, classification_type, created_at, document_summary"
    try:
        result = (
            supabase.table("documents")
            .select(columns)
            .order("created_at", desc=True)
            .limit(args.limit)
            .execute()
        )
    except Exception as e:
        # Some schemas use business_uuid and may require it; try without order
        try:
            result = (
                supabase.table("documents")
                .select(columns)
                .limit(args.limit)
                .execute()
            )
        except Exception as e2:
            print(f"❌ Query failed: {e2}")
            sys.exit(1)

    data = result.data or []
    if not data:
        print("No documents found in database.")
        sys.exit(0)

    print(f"Found {len(data)} documents:\n")
    filenames = []
    for doc in data:
        fn = doc.get("original_filename") or "unknown"
        filenames.append(fn)
        ct = doc.get("classification_type") or ""
        addr = ""
        if args.with_addresses and doc.get("document_summary"):
            summary = doc["document_summary"]
            if isinstance(summary, str):
                try:
                    summary = json.loads(summary)
                except Exception:
                    summary = {}
            if isinstance(summary, dict):
                sub = summary.get("subject_property") or {}
                if isinstance(sub, dict):
                    addr = (sub.get("property_address") or "").strip()
            if addr:
                print(f"  {fn}  |  {ct}  |  {addr}")
            else:
                print(f"  {fn}  |  {ct}")
        else:
            print(f"  {fn}  |  {ct}")

    # Output just filenames for easy copy-paste
    print("\n--- Filenames only (for TEST_QUERIES) ---")
    for fn in filenames:
        print(fn)


if __name__ == "__main__":
    main()
