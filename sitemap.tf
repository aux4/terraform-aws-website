data "archive_file" "sitemap" {
  count       = var.sitemap_api_url != "" ? 1 : 0
  type        = "zip"
  output_path = "${path.module}/.build/sitemap.zip"

  source {
    content  = templatefile("${path.module}/lambda-edge/sitemap.js.tpl", {
      site_url = "https://${var.website_domain}"
      api_url  = var.sitemap_api_url
    })
    filename = "sitemap.js"
  }
}

resource "aws_iam_role" "sitemap" {
  count = var.sitemap_api_url != "" ? 1 : 0
  name  = "${replace(var.website_domain, ".", "-")}-sitemap-${var.env}"

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

resource "aws_iam_role_policy_attachment" "sitemap" {
  count      = var.sitemap_api_url != "" ? 1 : 0
  role       = aws_iam_role.sitemap[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "sitemap" {
  count            = var.sitemap_api_url != "" ? 1 : 0
  function_name    = "${replace(var.website_domain, ".", "-")}-sitemap-${var.env}"
  role             = aws_iam_role.sitemap[0].arn
  handler          = "sitemap.handler"
  runtime          = "nodejs20.x"
  timeout          = 10
  publish          = true
  filename         = data.archive_file.sitemap[0].output_path
  source_code_hash = data.archive_file.sitemap[0].output_base64sha256
}
