const spawn = require('child_process').spawn
const request = require('request')
const chalk = require('chalk')

// The image extensions that we will be looking for in the network stream.
const parserName = 'Ngrep'
const extensions = [
  'gif', 'jpg', 'jpeg', 'png', 'svg', 'bmp', 'tif', 'tiff', 'pdf'
]

// The child process.  If ngrep terminates, we will attempt to restart it,
// and would prefer to keep the child itself out of the recursion.
var child

function run() {
  console.log(`${parserName}(${chalk.blue('startup')}) : Monitoring on ${process.env.MONITOR_INTERFACE}`)
  console.log(`${parserName}(${chalk.blue('startup')}) : Starting up child process`)
  child = spawn('ngrep', [
      '-d', process.env.MONITOR_INTERFACE,
      '-W', 'byline',
      '-qilw', '\'get\'',
      'tcp dst port 80'
  ])

  // If we have been requested to shut down, then we should do so gracefully
  process.on('SIGUSR2', function(){
    console.log(`${parserName}(${chalk.blue('shutdown')}) : Shutting down child process`)
    child.stdin.pause()
    child.kill()
    process.exit()
  })

  // Pass anything from standard error directly to the log.
  child.stderr.on('data', function(data) {
    console.log(`${parserName}(${chalk.yellow('stderr')}) : ${data.toString().replace(/(\r\n|\n|\r)/gm)}`)
  })

  // If ngrep exits for some reason, we should log the event to the console
  // and then initiate a new instance to work from.
  child.on('close', function(code) {
    console.log(`${parserName}(${chalk.yellow('close')}) : Child terminated with code ${code}`)
    run()
  })

  // If ngrep is failing to start, then we need to log that event
  child.on('error', function(error) {
    console.log(`${parserName}(${chalk.red('close')}) : Could not start the child process`)
  })

  // When ngrep outputs data to standard output, we want to capture that
  // data, interpret it, and hand it off to the database.
  child.stdout.on('data', function(data) {
    var entry = data.toString()

    // The two peices of information that we want to pull out of the header
    // are the DNS address and the URL path.
    var host = /Host\: (.*)\./gm.exec(entry)
    var path = /GET (.*) HTTP/gm.exec(entry)

    // Only if we have bost a path and a host should we continue.
    if (path && host) {
      // Our next step is to try to reconstruct the URL and then use that as
      // a basis to discover if this was a file that was being downloaded.
      var url = (`http://${host[1]}${path[1]}`)
      var baseUrl = (`http://${host[1]}${path[1].split('?').shift()}`)
      var extension = /(?:\.([^.]+))?$/.exec(path[1].split('?').shift())[1]

      // If the extension exists within the extension dictionary, then we
      // will continue parsing the URL.
      if extension.toLowerCase() in extensions {
        // Lets download the image file and then pass the image to the upstream
        // api server.
        httpreq.get(url, {binary: true}, function(err, res) {
          if (err) {
            console.log(`${parserName}(${chalk.red('download-error')}) : ${err}`)
          } else {
            console.log(`${parserName}(${chalk.green('upload')}) : ${baseUrl}`)
            request.get(url).pipe(request.post(`${process.env.API_ADDRESS}/api/image`))
          }
        })
      }
    }
  })
}