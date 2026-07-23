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

# Optional Lambda@Edge (generic)
# Attaches a consumer-provided origin-request Lambda@Edge function to a given
# path pattern. Disabled by default so existing consumers are not forced to ship
# an edge function. The module is app-agnostic: the consumer owns the function
# source and passes in a prebuilt zip. NOTE: Lambda@Edge functions must live in
# us-east-1; the module relies on the root module's provider already being
# us-east-1.

variable "edge_lambda_enabled" {
  description = "Enable the origin-request Lambda@Edge function on the edge_lambda_path_pattern cache behavior"
  type        = bool
  default     = false
}

variable "edge_lambda_filename" {
  description = "Path to the prebuilt deployment zip for the edge Lambda function (provided by the consumer). Required when edge_lambda_enabled is true."
  type        = string
  default     = ""
}

variable "edge_lambda_source_code_hash" {
  description = "Base64 SHA-256 hash of the deployment zip (provided by the consumer, e.g. archive_file.output_base64sha256). Required when edge_lambda_enabled is true."
  type        = string
  default     = ""
}

variable "edge_lambda_handler" {
  description = "Handler for the edge Lambda function"
  type        = string
  default     = "index.handler"
}

variable "edge_lambda_runtime" {
  description = "Runtime for the edge Lambda function"
  type        = string
  default     = "nodejs20.x"
}

variable "edge_lambda_memory_size" {
  description = "Memory (MB) for the edge Lambda function. Keep small; Lambda@Edge origin-request functions are size-constrained."
  type        = number
  default     = 128
}

variable "edge_lambda_timeout" {
  description = "Timeout (seconds) for the edge Lambda function. Origin-request Lambda@Edge allows up to 30s."
  type        = number
  default     = 5
}

variable "edge_lambda_path_pattern" {
  description = "CloudFront cache-behavior path pattern the edge Lambda is attached to (e.g. /r/public/packages/*)"
  type        = string
  default     = ""
}
