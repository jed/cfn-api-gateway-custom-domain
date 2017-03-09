#!/usr/local/lib64/node-v4.3.x/bin/node

'use strict'

var child_process = require('child_process')
var https = require('https')
var http = require('http')
var url = require('url')
var fs = require('fs')
var aws = require('aws-sdk')

var route53 = new aws.Route53()
var apiGateway = new aws.APIGateway()

if ('CERTBOT_DOMAIN' in process.env) runHook()

else exports.handler = function(event, context) {
  console.log("RECEIVED EVENT: %s", event.RequestType)
  var handlers = {Create, Delete, Update}
  var handler = handlers[event.RequestType] || function(event, cb) {
    cb(new TypeError(`Invalid RequestType: ${event.RequestType}`))
  }

  handler(event, (err, Data) => {
    var Status = err ? 'FAILED' : 'SUCCESS'
    var Reason = err ? err.message : `See the CloudWatch Log Stream: ${context.logStreamName}`
    var responseData = {
      Status,
      Reason,
      PhysicalResourceId: context.logStreamName,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data
    }

    console.log("RESPONSE: %j", responseData)

    if (!event.ResponseURL) return context.succeed(responseData)

    var responseBody = new Buffer(JSON.stringify(responseData))
    var uri = url.parse(event.ResponseURL)
    var options = {
      hostname: uri.hostname,
      port: 443,
      path: uri.path,
      method: 'PUT',
      headers: {
        'Content-Type': '',
        'Content-Length': responseBody.length
      }
    }

    var req = https.request(options)
      .on('error', onerror)
      .on('response', onresponse)

    function onresponse(res) {
      req.removeListener('error', onerror)

      if (res.statusCode == 200) return context.done()

      console.log(http.STATUS_CODES[res.statusCode])
      context.done()
    }

    function onerror(err) {
      req.removeListener('response', onresponse)

      console.log(err)
      context.done()
    }

    req.end(responseBody)
  })
}

function runHook() {
  var HostedZoneId = process.argv[2]
  var Action = process.env.CERTBOT_AUTH_OUTPUT ? 'DELETE' : 'UPSERT'
  var Name = `_acme-challenge.${process.env.CERTBOT_DOMAIN}`
  var Value = `"${process.env.CERTBOT_VALIDATION}"`

  var ResourceRecordSet = {Name, ResourceRecords: [{Value}], Type: 'TXT', TTL: 30}
  var Change = {Action, ResourceRecordSet}
  var params = {HostedZoneId, ChangeBatch: {Changes: [Change]}}

  route53.changeResourceRecordSets(params, (err, data) => {
    if (err) throw err

    if (Action === 'DELETE') return process.exit()

    var params = {Id: data.ChangeInfo.Id}

    route53.waitFor('resourceRecordSetsChanged', params, (err, data) => {
      if (err) throw err

      process.exit()
    })
  })
}

function Create(event, cb) {
  console.log('CREATING DOMAIN: %j', event)

  var ResourceProperties = event.ResourceProperties || {}

  var HostedZoneId = ResourceProperties.HostedZoneId
  if (!HostedZoneId) return cb(new Error('"HostedZoneId" missing in ResourceProperties'))

  var EmailAddress = process.env.EMAIL_ADDRESS

  var Subdomain = ResourceProperties.Subdomain

  route53.getHostedZone({Id: HostedZoneId}, (err, data) => {
    if (err) return cb(err)

    var domainName = data.HostedZone.Name.slice(0, -1)
    if (Subdomain) domainName = `${Subdomain}.${domainName}`

    var args = [
      'certonly',
      '--non-interactive',
      '--manual',
      '--manual-auth-hook', `/var/task/index.js ${HostedZoneId}`,
      '--manual-cleanup-hook', `/var/task/index.js ${HostedZoneId}`,
      '--preferred-challenge', 'dns',
      '--config-dir', '/tmp',
      '--work-dir', '/tmp',
      '--logs-dir', '/tmp',
      '--agree-tos',
      '--manual-public-ip-logging-ok',
      '--email', EmailAddress,
      '--domains', domainName
    ]

    console.log('CALLING CERTBOT: %j', args)

    var child = child_process.spawn('bin/certbot', args, {stdio: 'inherit'})

    child.on('error', onerror)
    child.on('exit', onexit)

    function onerror(err) {
      child.removeListener('exit', onexit)
      cb(err)
    }

    function onexit(code, signal) {
      child.removeListener('error', onerror)

      var date = new Date().toISOString().slice(0, 10)
      var certificateName = `lets-encrypt-certificate-for-${domainName}-${date}`

      var params = {domainName, certificateName}
      var paramKeys = ['Body', 'Chain', 'PrivateKey']
      var paramNames = paramKeys.map(x => `certificate${x}`)

      var fileNames = ['cert', 'chain', 'privkey']
      var filePaths = fileNames.map(x => `/tmp/live/${domainName}/${x}.pem`)
      var files = filePaths.map(path => {
        return new Promise((resolve, reject) => {
          fs.readFile(path, 'utf8', (err, data) => {
            err ? reject(err) : resolve(data)
          })
        })
      })

      Promise.all(files).then(fileData => {
        paramNames.forEach((name, i) => params[name] = fileData[i])

        apiGateway.createDomainName(params, cb)
      }, cb)
    }
  })
}

function Delete(event, cb) {
  console.log('DELETING DOMAIN: %j', event)

  var domainName = event.ResourceProperties.domainName

  apiGateway.getDomainName({domainName}, (err, data) => {
    if (!err || err.code === 'NotFoundException') return cb()

    apiGateway.deleteDomainName({domainName}, cb)
  })
}

function Update(event, cb) {
  var domainName = event.OldResourceProperties.domainName

  Delete({domainName}, (err, data) => err ? cb(err) : Create(event, cb))
}
