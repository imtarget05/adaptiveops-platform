# AWS IAM OpenID Connect Provider for GitHub Actions
resource "aws_iam_openid_connect_provider" "github" {
  count = (var.chargeable && !var.plan_only && var.enable_chargeable_resources) ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c587612c254df2a752803125d3b347f89586a94"]
}

resource "aws_iam_role" "github_actions_deployer" {
  count = (var.chargeable && !var.plan_only && var.enable_chargeable_resources) ? 1 : 0
  name  = "adaptiveops-github-deployer-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github[0].arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringLike = {
            "token.actions.githubusercontent.com:sub" : "repo:*/adaptiveops-platform:*"
          }
          StringEquals = {
            "token.actions.githubusercontent.com:aud" : "sts.amazonaws.com"
          }
        }
      }
    ]
  })
}
