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
  default     = "PriceClass_100"
}

variable "route53_zone_id" {
  description = "The Route 53 zone ID"
  type        = string
}
