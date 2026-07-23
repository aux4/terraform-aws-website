variable "env" {
  description = "The environment"
  type        = string
}

variable "aws_profile" {
  description = "The AWS profile to use"
  type        = string
}

variable "website_domain" {
  description = "The domain of the website"
  type        = string
}

variable "website_dist_folder" {
  description = "The folder containing the website distribution"
  type        = string
  default     = "../dist"
}

variable "cloudfront_price_class" {
  description = "The CloudFront price class"
  type        = string
  default     = "PriceClass_All"
}

variable "route53_zone_id" {
  description = "The Route 53 zone ID"
  type        = string
}

# Package SEO Lambda@Edge (optional)
# Injects per-package SEO metadata into the SPA shell on the
# /r/public/packages/* routes via a CloudFront origin-request trigger.
# Disabled by default so existing consumers are not forced to ship an edge
# function. NOTE: Lambda@Edge functions must live in us-east-1; the module
# relies on the root module's provider already being us-east-1 (the hub is).

variable "enable_package_seo_edge" {
  description = "Enable the Lambda@Edge origin-request function that injects per-package SEO metadata on /r/public/packages/* routes"
  type        = bool
  default     = false
}

variable "package_seo_lambda_handler" {
  description = "Handler for the package SEO Lambda@Edge function"
  type        = string
  default     = "index.handler"
}

variable "package_seo_lambda_runtime" {
  description = "Runtime for the package SEO Lambda@Edge function"
  type        = string
  default     = "nodejs20.x"
}

variable "package_seo_lambda_memory_size" {
  description = "Memory (MB) for the package SEO Lambda@Edge function. Lambda@Edge origin-request caps at 128 MB for viewer triggers but allows more for origin triggers; keep small."
  type        = number
  default     = 128
}

variable "package_seo_lambda_timeout" {
  description = "Timeout (seconds) for the package SEO Lambda@Edge function. Origin-request Lambda@Edge allows up to 30s."
  type        = number
  default     = 5
}
