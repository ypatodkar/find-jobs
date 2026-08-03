# Database schema — ER diagram

Generated from [`schema.sql`](schema.sql).

```mermaid
erDiagram
    JOBS {
        text job_id PK
        text company
        text title
        text city
        text url
        text ats
        text source
        integer remote
        text posted
        text firms
        text salary
        real salary_min
        real salary_max
        text seniority
        integer staff_count
        text size
        text stage
        text markets
        text domain
        integer first_seen
        integer last_seen
        integer active
        integer clicks
    }

    CLICKS {
        integer id PK
        text job_id FK
        text visitor_id FK
        integer ts
        text page
        text firm
        text country
    }

    USERS {
        text id PK
        text provider
        text provider_user_id
        text email
        text name
        text avatar_url
        integer created_at
    }

    SESSIONS {
        text token PK
        text user_id FK
        integer created_at
        integer expires_at
    }

    SEEN_JOBS {
        text user_id FK
        text job_id FK
        integer first_seen
    }

    FILTER_EVENTS {
        integer id PK
        text visitor_id FK
        integer ts
        text action
        text name
        text filters
        text page
        text firm
        text country
    }

    VISITORS {
        text visitor_id PK
        text name
        integer liked_at
        integer first_seen
        integer last_seen
        text country
    }

    JOBS       ||--o{ CLICKS        : "clicked in"
    VISITORS   ||--o{ CLICKS        : "makes"
    JOBS       ||--o{ SEEN_JOBS     : "seen via"
    USERS      ||--o{ SEEN_JOBS     : "has seen"
    USERS      ||--o{ SESSIONS      : "signs into"
    VISITORS   ||--o{ FILTER_EVENTS : "triggers"
```

## Notes

- `CLICKS`→`JOBS`/`VISITORS` and `SEEN_JOBS`→`JOBS` are not enforced with `REFERENCES` in
  the SQL — only `sessions.user_id` and `seen_jobs.user_id` actually declare a foreign key.
  The relationships above reflect intent, not a constraint SQLite is enforcing.
- `USERS` (real OAuth accounts) and `VISITORS` (anonymous per-browser IDs) are deliberately
  separate and never merged.
- `FILTER_EVENTS` carries a `visitor_id` but is explicitly documented in the schema as
  aggregate-only, not a per-user trail.
