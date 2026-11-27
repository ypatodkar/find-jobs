# Debugging resume analysis

Production API logs are in CloudWatch log group `/aws/lambda/find-jobs-api` in
`us-east-1`. Watch a reproduction with:

```sh
aws logs tail /aws/lambda/find-jobs-api --region us-east-1 --since 10m --follow
```

Each GET or POST to `/api/match` records a `resume_match_request` event with its
Lambda `requestId`, method, status, outcome, and elapsed milliseconds. This includes
handled failures before a model call and successful cached results.

An analysis that calls Jev also records:

- `jev_assessment_started`, followed by `jev_assessment_completed` or
  `jev_assessment_failed` (including validation of the returned assessment).
- `jev_attempt_started` and `jev_attempt_completed` with attempt number, provider
  HTTP status, and elapsed milliseconds; a transport failure has no HTTP response.
- `jev_retry` for rate limits or overload, including the retry delay.
- `jev_request_completed` or `jev_request_failed` with total elapsed milliseconds,
  attempt count, provider HTTP status when available, and a safe failure category.

`callId` connects events within a Jev call. `requestId` connects them to the Lambda
request and the response's existing `x-amzn-requestid` header. Scraper calls use the
same Jev request logs in GitHub Actions, but have no Lambda request ID.

Categories distinguish timeout, network, authentication, rate_limit, overloaded,
provider_http, invalid_json, invalid_assessment, no_requirements, not_configured,
request_preparation, and unexpected failures. The absence of Jev events does not
prove a model outage: inspect the API outcome for authentication/validation errors
or a cached result, and check whether the request reached Lambda at all.

The new structured events do not include resumes, job text, prompts, provider
responses, API keys, cookies, account IDs, scores, or raw provider error messages.
The existing client error messages, retries, quota behavior, and scoring remain
unchanged. These logs improve diagnosis; they do not establish the cause of an
earlier failure that was not recorded.
