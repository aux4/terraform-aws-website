terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_s3_bucket" "logs" {
  bucket = "${var.env}-logs.${var.website_domain}"
}

resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.bucket

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_acl" "logs" {
  bucket = aws_s3_bucket.logs.bucket
  acl    = "log-delivery-write"

  depends_on = [
    aws_s3_bucket_ownership_controls.logs
  ]
}

resource "aws_s3_bucket" "website" {
  bucket = var.env == "prod" ? var.website_domain : "${var.env}.${var.website_domain}"
}

resource "aws_s3_bucket_policy" "website" {
  bucket = aws_s3_bucket.website.bucket
  policy = <<POLICY
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "WebsitePerm",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::${var.env == "prod" ? "" : "${var.env}."}${var.website_domain}/*"
        }
    ]
}
POLICY
}

resource "aws_s3_bucket_ownership_controls" "website" {
  bucket = aws_s3_bucket.website.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_public_access_block" "website" {
  bucket = aws_s3_bucket.website.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_acl" "website" {
  bucket = aws_s3_bucket.website.bucket
  acl    = "public-read"

  depends_on = [
    aws_s3_bucket_ownership_controls.website,
    aws_s3_bucket_public_access_block.website
  ]
}

resource "aws_s3_bucket_website_configuration" "website" {
  bucket = aws_s3_bucket.website.bucket

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html"
  }
}

resource "aws_s3_bucket" "www" {
  bucket = var.env == "prod" ? "www.${var.website_domain}" : "www.${var.env}.${var.website_domain}"

  depends_on = [
    aws_s3_bucket.website
  ]
}

resource "aws_s3_bucket_website_configuration" "www" {
  bucket = aws_s3_bucket.www.bucket

  redirect_all_requests_to {
    host_name = var.env == "prod" ? "https://${var.website_domain}" : "https://${var.env}.${var.website_domain}"
    protocol  = "https"
  }
}

resource "aws_s3_bucket_ownership_controls" "www" {
  bucket = aws_s3_bucket.www.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_public_access_block" "www" {
  bucket = aws_s3_bucket.www.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_acl" "www" {
  bucket = aws_s3_bucket.www.bucket
  acl    = "public-read"

  depends_on = [
    aws_s3_bucket_ownership_controls.www,
    aws_s3_bucket_public_access_block.www
  ]
}

resource "null_resource" "upload" {
  triggers = {
    run_when = sha1(file("./terraform.tfstate.d/${var.env}/last-build.txt"))
  }
  depends_on = [aws_s3_bucket.website]
  provisioner "local-exec" {
    command = "aws --profile ${var.aws_profile} s3 rm --recursive --exclude 'sitemap.xml' s3://${aws_s3_bucket.website.bucket} && aws --profile ${var.aws_profile} s3 cp --cache-control 'max-age=86400' --recursive ${var.website_dist_folder} s3://${aws_s3_bucket.website.bucket}"
  }
}
