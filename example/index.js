exports.handler = function(event, context) {
  context.succeed({
    statusCode: 302,
    headers: {Location: process.env.TARGET_LOCATION}
  })
}
