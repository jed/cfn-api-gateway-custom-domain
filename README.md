# cfn-api-gateway-custom-domain

This is a [CloudFormation][] [custom resource][] for [API Gateway][] [custom domains][]. It runs [Certbot][] on [Lambda][] to create certificates, and automatically creates [Route53][] DNS records to respond to [Let's Encrypt][] domain ownership challenges.

It's basically a [prollyfill][] for the conspicuously missing `AWS::ApiGateway::DomainName` resource type, which will likely land if/when [AWS Certificate Manager][] supports API Gateway.

If you need to renew your certificates or would like to just use Route53 to create Let's Encrypt certificates, check out [certbot-route53.sh][].

Features
--------

- **Fast**: Certificates are installed and enabled in minutes
- **Free**: Certificates cost nothing (but you can [donate][])
- **Easy**: Certificates need only 14 lines in a CloudFormation template
- **Safe**: Certificates never touch your email or machine

Setup
-----

Before you get started, you'll need to:

1. create a Route53 [public hosted zone][] for the domain, and
2. point the domain at [your zone's nameservers][].

Since Let's Encrypt needs to be able to contact Route53, your DNS settings must be in effect already.

Usage
-----

1. First, make sure you have a `AWS::Route53::HostedZone` in the `Resources` section of your template:

    ```yaml
      MyHostedZone:
        Type: AWS::Route53::HostedZone
        Properties:
          Name: jed.is
    ```

2. Then, add an API Gateway Custom Domain stack to your template:

    ```yaml
      ApiGatewayCustomDomain:
        Type: AWS::CloudFormation::Stack
        Properties:
          TemplateURL: https://s3.amazonaws.com/api-gateway-custom-domain/stack.template
          Parameters:
            LetsEncryptAccountEmail: me@jedschmidt.com
            LetsEncryptAgreeTOS: Yes
            LetsEncryptManualPublicIpLoggingOk: Yes
    ```

    You'll need to specify three things:

    - `LetsEncryptAccountEmail`: The email address associated with your Let's Encrypt account
    - `LetsEncryptAgreeTOS`: That you agree to the [Let's Encrypt Terms of Service][]. This must be `Yes`.
    - `LetsEncryptManualPublicIpLoggingOk`: That you're okay with Let's Encrypt logging the IP address of the Lambda used to run `certbot`. This must be `Yes`.

    This stack has only one output: `ServiceToken`. This can be accessed using `!GetAtt {your-logical-stack-name}.Outputs.ServiceToken`.

3. Finally, add a custom domain to your template:

    ```yaml
      MyDomain:
        Type: Custom::ApiGatewayCustomDomain
        Properties:
          ServiceToken: !GetAtt ApiGatewayCustomDomain.Outputs.ServiceToken
          HostedZoneId: !Ref MyHostedZone
          Subdomain: who
    ```

    You'll need to specify two things:

    - `Service Token`: The Service token output by your API Gateway Custom Domain stack
    - `HostedZoneId`: A reference to the existing `AWS::Route53::HostedZone` resource for which you're creating a certificate.

    You can also optionally specify:

    - `Subdomain`: The subdomain prefix for which you're creating a certificate, such as `www`. This is concatenated with the `Name` of the hosted zone, to create the full domain name. If this is omitted, the bare apex domain is used.

    This resource returns the results of the [createDomainName][] function.

At this point, you've done all you need to create/update/deploy your stack and get your certificate installed into API Gateway, but to user the domain you'll need to add an alias DNS record that resolves your domain to the CloudFront distribution created with your custom domain name, and then map the domain to a stage of your rest API:

```yaml
  MyDNSRecord:
    Type: AWS::Route53::RecordSetGroup
    Properties:
      HostedZoneId: !Ref MyHostedZone
      RecordSets:
      - Type: A
        Name: !GetAtt MyDomain.domainName
        AliasTarget:
          HostedZoneId: Z2FDTNDATAQYW2 # (hardcoded for all CloudFormation templates)
          DNSName: !GetAtt MyDomain.distributionDomainName

  MyPathMapping:
    Type: AWS::ApiGateway::BasePathMapping
    Properties:
      DomainName: !GetAtt MyDomain.domainName
      RestApiId: !Ref MyRestAPI
      Stage: prod
```

Example
-------

See the included [example][] for a simple website redirect app configured entirely with CloudFormation.

How it works
------------

When a custom domain name is first created in your stack, CloudFormation calls a [node.js function][] in a [Lambda-backed custom resource][], which in turn launches [Certbot][] in a Python subprocess. Certbot then contacts Let's Encrypt to get a challenge string, which is placed in a TXT record on Route53. Once the record is live, Certbot tells Let's Encrypt to verify it, and once it's verified, Let's Encrypt sends the certificate back to Certbot and then to API Gateway, where it's used to create a custom domain.

Todo
----

- [Automate certificate renewal](#1)
- [Revoke certificates on deletion](#2)

Thanks
------

- [Let's Encrypt][] for taking the tedium and cost out of making web sites more secure.
- [Michael Hart][] overall really, but in particular for the amazing [docker-lambda][], without which this project would not be possible.
- [Eric Hammond][], for his helpful [explorations of CloudFormation and Lambda][].

[API Gateway]: https://aws.amazon.com/api-gateway
[Lambda]: https://aws.amazon.com/lambda
[custom domains]: http://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-custom-domains.html
[CloudFormation]: https://aws.amazon.com/cloudformation
[custom resource]: http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-custom-resources.html
[Route53]: https://aws.amazon.com/route53
[Let's Encrypt]: https://letsencrypt.org
[Certbot]: https://certbot.eff.org
[certbot-route53.sh]: https://git.io/vylLx
[createDomainName]: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/APIGateway.html#createDomainName-property
[public hosted zone]: http://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingHostedZone.html
[your zone's nameservers]: http://docs.aws.amazon.com/Route53/latest/DeveloperGuide/GetInfoAboutHostedZone.html
[example]: https://github.com/jed/cfn-api-gateway-custom-domain/blob/master/example/stack.template
[Lambda-backed custom resource]: http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-custom-resources-lambda.html
[node.js function]: https://github.com/jed/cfn-api-gateway-custom-domain/blob/master/index.js
[explorations of CloudFormation and Lambda]: https://alestic.com
[Eric Hammond]: https://alestic.com/about/
[docker-lambda]: https://github.com/lambci/docker-lambda
[Michael Hart]: https://twitter.com/hichaelmart
[Let's Encrypt Terms of Service]: https://gist.github.com/kennwhite/9541c8f37ec2994352c4554ca2afeece
[prollyfill]: https://twitter.com/slexaxton/status/257543702124306432?lang=en
[AWS Certificate Manager]: https://aws.amazon.com/certificate-manager/
[donate]: https://letsencrypt.org/donate/
