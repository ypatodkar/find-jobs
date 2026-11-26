SELECT s.created_at, concat_ws(E'\n', s.company_name, s.submitted_url, s.notes) AS suggestion,
       s.company_name, s.submitted_url, s.notes, s.country,
       s.visitor_id, s.visitor_name, s.account_id, a.name AS account_name,
       a.email AS account_email, s.page, s.firm, s.list_country, s.list_view,
       s.locale, s.timezone, s.user_agent, s.id
FROM company_suggestions s
LEFT JOIN accounts a ON a.id = s.account_id
ORDER BY s.created_at DESC, s.id;
