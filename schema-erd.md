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
        text user_id FK
        integer ts
        text page
        text firm
        text country
    }

    FILTER_EVENTS {
        integer id PK
        text user_id FK
        integer ts
        text action
        text name
        text filters
        text page
        text firm
        text country
    }

    USERS {
        text user_id PK
        text name
        integer liked_at
        integer first_seen
        integer last_seen
        text country
    }

    JOBS  ||--o{ CLICKS        : "clicked in"
    USERS ||--o{ CLICKS        : "makes"
    USERS ||--o{ FILTER_EVENTS : "triggers"
```

## Notes

- There is no sign-in. A `users.user_id` is a UUID the browser mints for itself — no
  email, no password, no IP. `name` is optional, whatever someone typed when asked.
- No relationship above is enforced with `REFERENCES`; SQLite is not constraining them.
  The diagram reflects intent.
- `filter_events` carries a `user_id` but the schema documents it as aggregate product
  feedback, not a per-person trail.
