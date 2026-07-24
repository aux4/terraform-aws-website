# CloudFront Function that rewrites directory-style request URIs to their
# index.html. The CloudFront origin is the S3 REST endpoint, which has no
# index-document support, so a request for "/executors" (or "/executors/")
# would otherwise 404 and fall back to /index.html. This makes prerendered
# static pages (e.g. dist/executors/index.html) reachable at their route.
#
# Requests that already reference a file (contain a ".") are left untouched,
# so assets like /assets/app.js are served directly. Routes without a
# matching object still 404 -> /index.html via custom_error_response, so
# pure single-page apps behave exactly as before.
resource "aws_cloudfront_function" "directory_index" {
  name    = "${replace(var.website_domain, ".", "-")}-${var.env}-directory-index"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite directory URIs to index.html for ${var.website_domain} (${var.env})"
  publish = true
  code    = <<-EOT
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
  } else if (!uri.includes(".")) {
    request.uri = uri + "/index.html";
  }
  return request;
}
EOT
}
