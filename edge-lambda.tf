# Optional Lambda@Edge (generic)
#
# When var.edge_lambda_enabled is true, this creates a versioned
# (publish = true) Lambda function wired as a CloudFront origin-request trigger
# on the var.edge_lambda_path_pattern cache behavior (see cloudfront.tf).
#
# This capability is GENERIC: the module knows nothing about what the function
# does. The consumer owns the function source, builds the deployment zip, and
# passes it in via var.edge_lambda_filename + var.edge_lambda_source_code_hash.
# There is no app-specific code, naming, or archive packaging in this module.
#
# Constraints:
#   - Lambda@Edge functions MUST be created in us-east-1. This module relies on
#     the root module's default provider already being us-east-1. No aliased
#     provider is required here, so consumers who leave the feature disabled are
#     unaffected.
#   - Lambda@Edge forbids environment variables, so none are set. Any config the
#     function needs must be baked into the consumer-provided zip.

resource "aws_iam_role" "edge_lambda" {
  count = var.edge_lambda_enabled ? 1 : 0
  name  = "${replace(var.website_domain, ".", "-")}-edge-${var.env}"

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

resource "aws_iam_role_policy_attachment" "edge_lambda" {
  count      = var.edge_lambda_enabled ? 1 : 0
  role       = aws_iam_role.edge_lambda[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "edge_lambda" {
  count            = var.edge_lambda_enabled ? 1 : 0
  function_name    = "${replace(var.website_domain, ".", "-")}-edge-${var.env}"
  role             = aws_iam_role.edge_lambda[0].arn
  filename         = var.edge_lambda_filename
  source_code_hash = var.edge_lambda_source_code_hash
  handler          = var.edge_lambda_handler
  runtime          = var.edge_lambda_runtime
  memory_size      = var.edge_lambda_memory_size
  timeout          = var.edge_lambda_timeout
  publish          = true
}

resource "aws_lambda_permission" "edge_lambda" {
  count         = var.edge_lambda_enabled ? 1 : 0
  statement_id  = "${var.env}-${replace(var.website_domain, ".", "-")}-edge-permission"
  action        = "lambda:GetFunction"
  function_name = aws_lambda_function.edge_lambda[0].function_name
  qualifier     = aws_lambda_function.edge_lambda[0].version
  principal     = "edgelambda.amazonaws.com"
}
