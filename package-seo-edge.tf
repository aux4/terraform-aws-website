# Package SEO Lambda@Edge (optional)
#
# When var.enable_package_seo_edge is true, this creates a versioned
# (publish = true) Lambda function used as a CloudFront origin-request trigger
# on the /r/public/packages/* cache behavior (see cloudfront.tf). It injects
# per-package <title>/<meta>/JSON-LD into the SPA shell on cache-miss so that
# crawlers see unique metadata instead of the identical empty shell.
#
# Constraints:
#   - Lambda@Edge functions MUST be created in us-east-1. This module relies on
#     the root module's default provider already being us-east-1 (the hub is).
#     No aliased provider is required here, so consumers who leave the feature
#     disabled are unaffected.
#   - Lambda@Edge forbids environment variables, so none are set. Any config the
#     function needs (e.g. the metadata API URL) must be baked into the code
#     (HUB-008's responsibility).
#
# The function source is built at plan time from lambda-edge/package-seo with
# data "archive_file", so the deployed artifact always matches the source in the
# module and no stale zip is ever committed to git.

data "archive_file" "package_seo_edge" {
  count       = var.enable_package_seo_edge ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/lambda-edge/package-seo"
  excludes    = ["test", "test/**", "README.md", "package.json"]
  output_path = "${path.module}/lambda-edge/package-seo.zip"
}

resource "aws_iam_role" "package_seo_edge" {
  count = var.enable_package_seo_edge ? 1 : 0
  name  = "${replace(var.website_domain, ".", "-")}-package-seo-${var.env}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = [
            "lambda.amazonaws.com",
            "edgelambda.amazonaws.com"
          ]
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "package_seo_edge" {
  count      = var.enable_package_seo_edge ? 1 : 0
  role       = aws_iam_role.package_seo_edge[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "package_seo_edge" {
  count            = var.enable_package_seo_edge ? 1 : 0
  function_name    = "${replace(var.website_domain, ".", "-")}-package-seo-${var.env}"
  role             = aws_iam_role.package_seo_edge[0].arn
  filename         = data.archive_file.package_seo_edge[0].output_path
  source_code_hash = data.archive_file.package_seo_edge[0].output_base64sha256
  handler          = var.package_seo_lambda_handler
  runtime          = var.package_seo_lambda_runtime
  memory_size      = var.package_seo_lambda_memory_size
  timeout          = var.package_seo_lambda_timeout
  publish          = true
}

resource "aws_lambda_permission" "package_seo_edge" {
  count         = var.enable_package_seo_edge ? 1 : 0
  statement_id  = "${var.env}-${replace(var.website_domain, ".", "-")}-package-seo-permission"
  action        = "lambda:GetFunction"
  function_name = aws_lambda_function.package_seo_edge[0].function_name
  qualifier     = aws_lambda_function.package_seo_edge[0].version
  principal     = "edgelambda.amazonaws.com"
}
