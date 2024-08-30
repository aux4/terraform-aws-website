resource "aws_acm_certificate" "website_certificate" {
  domain_name       = var.env == "prod" ? "*.${var.website_domain}" : "*.${var.env}.${var.website_domain}"
  validation_method = "DNS"
}

resource "aws_route53_record" "website_route" {
  for_each = {
    for dvo in aws_acm_certificate.website_certificate.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = var.route53_zone_id
}

resource "aws_acm_certificate_validation" "website_certificate_validation" {
  certificate_arn         = aws_acm_certificate.website_certificate.arn
  validation_record_fqdns = [for record in aws_route53_record.website_route : record.fqdn]
}
