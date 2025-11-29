# Database Migration: Add `classification_reasoning` Column

## 📋 Summary

We need to add a missing database column (`classification_reasoning`) to fix document deletion issues and simplify our codebase.

---

## 🔍 What Happened: The Problem

### The Issue
When users tried to delete documents, the system was throwing this error:
```
(psycopg2.errors.UndefinedColumn) column document.classification_reasoning does not exist
```

### Why This Happened
1. **The Code Expects the Column**: Our Python code (in `backend/models.py`) defines a `Document` model that includes a `classification_reasoning` column. This column is meant to store an explanation of why a document was classified as a certain type (e.g., "valuation_report" or "market_appraisal").

2. **The Database Doesn't Have It**: The actual PostgreSQL database table doesn't have this column yet. This is a schema mismatch.

3. **SQLAlchemy Tries to Query All Columns**: When our code uses SQLAlchemy ORM (Object-Relational Mapping) to query documents, it automatically tries to SELECT all columns defined in the model, including `classification_reasoning`. Since the column doesn't exist in the database, PostgreSQL throws an error.

### The Temporary Fix We Implemented
To keep the system working while we fix the database, we implemented a workaround:

- **Changed from ORM queries to raw SQL queries** in the document deletion function
- **Only select columns that exist**: Instead of `Document.query.get()`, we now use raw SQL that explicitly selects only: `id`, `original_filename`, `s3_path`, `business_id`, `property_id`
- **Created a wrapper class** (`MinimalDocument`) to handle the raw SQL results

**This works, but it's a temporary solution.** The code is more complex and harder to maintain than it should be.

---

## ✅ The Solution: Add the Missing Column

### What is `classification_reasoning`?
This column stores a text explanation of how/why a document was classified. For example:
- `"Keyword analysis: valuation_report scored 15 matches. Matched: 'valuation report', 'surveyor', 'assessed value'"`
- `"Classification failed: [error message]"`

It's useful for:
- **Debugging**: Understanding why documents were classified incorrectly
- **Transparency**: Users can see the reasoning behind classifications
- **Future features**: We can show this in the UI or use it to improve classification

### Database Migration Required

You need to add the `classification_reasoning` column to the `document` table in PostgreSQL.

---

## 🛠️ Instructions for Database Administrator

### Step 1: Connect to Your PostgreSQL Database

Connect to your PostgreSQL database using your preferred method (psql, pgAdmin, etc.).

### Step 2: Run the Migration SQL

Execute the following SQL command:

```sql
-- Add the classification_reasoning column to the document table
ALTER TABLE document 
ADD COLUMN classification_reasoning TEXT;
```

**That's it!** The column is nullable (can be NULL), so:
- Existing documents will have `NULL` for this column (which is fine)
- New documents will have the reasoning text populated automatically
- No data migration needed

### Step 3: Verify the Column Was Added

Run this query to verify:

```sql
-- Check that the column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'document' 
  AND column_name = 'classification_reasoning';
```

You should see:
```
column_name              | data_type | is_nullable
-------------------------|-----------|------------
classification_reasoning | text      | YES
```

### Step 4: Test Document Operations

After adding the column, test:
1. **Document deletion** - Should work without errors
2. **Document upload** - Should work normally
3. **Document classification** - New documents should populate the `classification_reasoning` field

---

## 📊 Impact Assessment

### Before Adding the Column
- ✅ System works (with workarounds)
- ❌ Code is more complex (raw SQL everywhere)
- ❌ Harder to maintain
- ❌ Missing useful debugging information

### After Adding the Column
- ✅ System works (using standard ORM queries)
- ✅ Code is simpler and cleaner
- ✅ Easier to maintain
- ✅ Full classification reasoning available for debugging
- ✅ Can remove all the workaround code

### Risk Level: **LOW**
- The column is nullable, so it won't break existing data
- No data migration required
- Can be added at any time
- If something goes wrong, we can drop the column: `ALTER TABLE document DROP COLUMN classification_reasoning;`

---

## 🔄 What Happens Next (After You Add the Column)

Once you've added the column, we can:
1. **Simplify the code** - Remove all the raw SQL workarounds
2. **Use standard ORM queries** - `Document.query.get()` will work normally
3. **Remove the MinimalDocument class** - No longer needed
4. **Improve error handling** - Simpler, cleaner code

The system will continue working exactly as it does now, but the code will be much cleaner.

---

## ❓ Questions or Issues?

If you encounter any issues:
1. **Column already exists?** - If you get "column already exists" error, that's fine! It means it's already there.
2. **Permission errors?** - Make sure you're connected as a user with ALTER TABLE permissions
3. **Can't connect?** - Check your database connection string and credentials

---

## 📝 Technical Details (For Reference)

### Current Code Location
The workaround code is in:
- `backend/views.py` - `delete_document()` function (lines ~2647-2683)
- `backend/views.py` - `proxy_upload()` function (lines ~1753-1851)

### Model Definition
The column is defined in:
- `backend/models.py` - `Document` class (line 64)

### What the Column Stores
- **Type**: `TEXT` (unlimited length)
- **Nullable**: `YES` (can be NULL)
- **Purpose**: Stores classification reasoning/explanation
- **Example values**:
  - `"Keyword analysis: valuation_report scored 15 matches out of 20 total. Matched: 'valuation report', 'surveyor'"`
  - `"Classification failed: [error message]"`

---

## ✅ Checklist

- [ ] Connected to PostgreSQL database
- [ ] Ran `ALTER TABLE document ADD COLUMN classification_reasoning TEXT;`
- [ ] Verified column exists with verification query
- [ ] Tested document deletion (should work without errors)
- [ ] Tested document upload (should work normally)
- [ ] Notified development team that migration is complete

---

**Once you've completed this migration, let the development team know and we'll clean up the workaround code!**

