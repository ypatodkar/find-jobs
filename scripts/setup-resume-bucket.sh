#!/usr/bin/env bash
#
# One-time AWS setup for keeping original resume files (aws/lambda/file-store.cjs).
#
#   scripts/setup-resume-bucket.sh
#
# Safe to run again: each step leaves an existing setting as it should be. It:
#
#   1. creates a private bucket, find-jobs-resumes-<account id>, in us-east-1
#   2. blocks every form of public access to it
#   3. encrypts everything in it at rest (SSE-S3)
#   4. refuses any request that is not over TLS
#   5. erases files tagged deleted=true 30 days after tagging, and cleans up
#      abandoned partial uploads after a day
#   6. lets the API's role (find-jobs-api-role) write, tag, read and delete under
#      resumes/ in that bucket, and nothing else
#   7. sets RESUME_BUCKET on the find-jobs-api Lambda, keeping its other settings
#
# Run it before releasing the API that stores files, and release that API before the
# site that uploads them (README, "Releasing").

set -euo pipefail

REGION=us-east-1
FUNCTION=find-jobs-api
ROLE=find-jobs-api-role
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="find-jobs-resumes-${ACCOUNT}"

echo "Bucket: ${BUCKET}"

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "  exists"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  echo "  created"
fi

aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-ownership-controls --bucket "$BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"TLSOnly\", \"Effect\": \"Deny\", \"Principal\": \"*\", \"Action\": \"s3:*\",
    \"Resource\": [\"arn:aws:s3:::${BUCKET}\", \"arn:aws:s3:::${BUCKET}/*\"],
    \"Condition\": { \"Bool\": { \"aws:SecureTransport\": \"false\" } }
  }]
}"
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules": [
    { "ID": "erase-deleted-resumes", "Status": "Enabled",
      "Filter": { "Tag": { "Key": "deleted", "Value": "true" } },
      "Expiration": { "Days": 30 } },
    { "ID": "abandoned-uploads", "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 } }
  ]
}'
echo "  private, encrypted, TLS only, deleted files erased after 30 days"

aws iam put-role-policy --role-name "$ROLE" --policy-name resume-files --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Action\": [\"s3:PutObject\", \"s3:PutObjectTagging\", \"s3:GetObject\", \"s3:DeleteObject\"],
    \"Resource\": \"arn:aws:s3:::${BUCKET}/resumes/*\"
  }]
}"
echo "Role ${ROLE}: may read and write ${BUCKET}/resumes/*"

# update-function-configuration replaces the whole environment, so the current
# variables are read and RESUME_BUCKET added to them. They pass through a private temp
# file, removed on exit, and are never printed.
tmp=$(mktemp)
chmod 600 "$tmp"
trap 'rm -f "$tmp"' EXIT
aws lambda get-function-configuration --region "$REGION" --function-name "$FUNCTION" \
  --query 'Environment.Variables' --output json > "$tmp"
node -e '
  const fs = require("fs");
  const vars = JSON.parse(fs.readFileSync(process.argv[1], "utf8")) || {};
  vars.RESUME_BUCKET = process.argv[2];
  fs.writeFileSync(process.argv[1], JSON.stringify({ Variables: vars }));
' "$tmp" "$BUCKET"
aws lambda update-function-configuration --region "$REGION" --function-name "$FUNCTION" \
  --environment "file://${tmp}" --query 'LastUpdateStatus' --output text >/dev/null
aws lambda wait function-updated --region "$REGION" --function-name "$FUNCTION"
echo "Lambda ${FUNCTION}: RESUME_BUCKET=${BUCKET}"
echo "Done."
