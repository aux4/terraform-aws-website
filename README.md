# terraform-aws-website
AWS S3 Static Website Terraform Module

## Usage

### Terraform

terraform/main.tf

```hcl
module "website" {
  source = "git@github.com:aux4/terraform-aws-website.git?ref=v1"

  env = var.env
  aws_profile = var.aws_profile

  website_domain = "yourdomain.com"
  website_dist_folder = "../dist" # default value

  cloudfront_price_class = "PriceClass_All" # default value

  route53_zone_id = data.aws_route53_zone.website.zone_id
}
```
