## How to Run ROUND3_MIGRATION.sql

You have three options based on your database setup:

---

## Option 1: Using psql (Command Line)

If you have PostgreSQL installed locally or SSH access to your server:

```bash
psql -h YOUR_HOST -U YOUR_USERNAME -d YOUR_DATABASE_NAME -f ROUND3_MIGRATION.sql
```

Example:
```bash
psql -h db.render.com -U postgres -d smart_mailbox_db -f ROUND3_MIGRATION.sql
```

When prompted, enter your database password.

---

## Option 2: Using pgAdmin (GUI)

If you use pgAdmin (web interface):

1. Log into pgAdmin: https://pgadmin.render.com or your pgAdmin URL
2. Navigate to your database
3. Right-click on the database → "Query Tool"
4. Open ROUND3_MIGRATION.sql file
5. Copy and paste the entire SQL script into the Query Tool
6. Click "Execute" (or press F5)
7. Check the "Messages" tab for "Query returned successfully"

---

## Option 3: Using Render Database Dashboard

If your database is hosted on Render:

1. Go to: https://dashboard.render.com
2. Find your Postgres database instance
3. Click "Connect" → "External Connection"
4. Use the connection string in your PostgreSQL client
5. Run the migration using Option 1 (psql)

Or use Render's built-in SQL Editor (if available):
1. In database dashboard, click "Database" tab
2. Click "SQL" or "Query Editor"
3. Paste the script and execute

---

## Option 4: Using Supabase (if applicable)

If using Supabase:

1. Log into: https://supabase.com
2. Go to your project → SQL Editor
3. Click "+ New Query"
4. Paste the entire ROUND3_MIGRATION.sql content
5. Click "Run" (or CMD+Enter)
6. Check output for success

---

## What to Provide:

Tell me which database platform you use, and I'll give you exact connection details:

- **Render Postgres** → Need: database hostname, username, password, database name
- **Railway** → Need: connection string
- **Supabase** → Need: project URL + access
- **AWS RDS** → Need: endpoint, username, password, database name
- **Heroku Postgres** → Need: database URL
- **Local PostgreSQL** → Just run Option 1

**Where do I find my database credentials?**

For Render: Dashboard → Postgres → "Connections"
For Supabase: Dashboard → Settings → Database
For AWS RDS: RDS Console → Databases → your instance → Connectivity
For Railway: Dashboard → your project → Database → Connect

---

## After Running Migration:

Verify it worked by running these check queries:

```sql
-- Check soft-delete columns exist
SELECT column_name FROM information_schema.columns 
WHERE table_name='users' AND column_name IN ('deleted_at', 'deleted_by');

-- Check admin_audit_log table exists
SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='admin_audit_log');

-- Check quota columns
SELECT column_name FROM information_schema.columns 
WHERE table_name='user_quota' AND column_name IN ('last_warning_email_sent', 'is_at_limit');
```

All three queries should return positive results (columns/tables found).

---

## Need Help?

Provide:
1. Your database platform (Render, Railway, Supabase, AWS RDS, etc.)
2. Your database connection string (or individual credentials)

I'll run the migration for you directly or give you the exact command to copy-paste.
