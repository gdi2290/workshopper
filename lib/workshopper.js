const argv       = require('optimist').argv
    , fs         = require('fs')
    , path       = require('path')
    , mkdirp     = require('mkdirp')
    , map        = require('map-async')
    , msee       = require('msee')
    , chalk      = require('chalk')

const showMenu  = require('./menu')
    , print     = require('./print-text')
    , repeat    = require('./term-util').repeat
    , yellow    = require('./term-util').yellow
    , util      = require('./util')

const defaultWidth = 65


function Workshopper (options) {
  if (!(this instanceof Workshopper))
    return new Workshopper(options)

  var stat
    , menuJson

  if (typeof options != 'object')
    throw new TypeError('need to provide an options object')

  if (typeof options.name != 'string')
    throw new TypeError('need to provide a `name` String option')

  if (typeof options.title != 'string')
    throw new TypeError('need to provide a `title` String option')

  if (typeof options.exerciseDir != 'string')
    throw new TypeError('need to provide an "exerciseDir" String option')

  stat = fs.statSync(options.exerciseDir)
  if (!stat || !stat.isDirectory())
    throw new Error('"exerciseDir" [' + options.exerciseDir + '] does not exist or is not a directory')

  if (typeof options.appDir != 'string')
    throw new TypeError('need to provide an "appDir" String option')

  stat = fs.statSync(options.appDir)
  if (!stat || !stat.isDirectory())
    throw new Error('"appDir" [' + options.appDir + '] does not exist or is not a directory')

  menuJson = path.join(options.exerciseDir, 'menu.json')
  stat = fs.statSync(menuJson)
  if (!stat || !stat.isFile())
    throw new Error('[' + menuJson + '] does not exist or is not a file')


  this.appName     = options.name
  this.title       = options.title
  this.subtitle    = options.subtitle
  this.menuOptions = options.menu
  this.helpFile    = options.helpFile
  this.creditsFile = options.creditsFile
  this.prerequisitesFile = options.prerequisitesFile
  this.width       = typeof options.width == 'number' ? options.width : defaultWidth
  this.exerciseDir = options.exerciseDir
  this.appDir      = options.appDir
  this.exercises   = require(menuJson)

  this.dataDir     = path.join(
      process.env.HOME || process.env.USERPROFILE
    , '.config'
    , this.appName
  )

  mkdirp.sync(this.dataDir)


  if (argv.h || argv.help || argv._[0] == 'help')
    return this._printHelp()

  if (argv._[0] == 'credits')
    return this._printCredits()

  if (argv._[0] == 'prerequisites')
    return this._printPrerequisities()

  if (argv.v || argv.version || argv._[0] == 'version')
    return console.log(this.appName + '@' + require(path.join(this.appDir, 'package.json')).version)

  if (argv._[0] == 'list') {
    return this.exercises.forEach(function (name) {
      console.log(name)
    })
  }

  if (argv._[0] == 'current')
    return console.log(this.getData('current'))

  if (argv._[0] == 'select' || argv._[0] == 'print') {
    return onselect.call(this, argv._.length > 1
      ? argv._.slice(1).join(' ')
      : this.getData('current')
    )
  }

  if (argv._[0] == 'verify' || argv._[0] == 'run') {
    if (argv._.length == 1)
      return error('Usage:', this.appName, argv._[0], 'mysubmission.js')
    return this.execute(argv._[0], argv._.slice(1))
  }

  this.printMenu()
}


Workshopper.prototype.fail = function (mode, exercise) {
  console.log(chalk.bold.red('# FAIL'))
  console.log('\nYour solution to ' + exercise.name + ' didn\'t pass. Try again!\n')

  this.end(mode, false, exercise)
}


Workshopper.prototype.end = function (mode, pass, exercise) {
  exercise.end(mode, pass, function (err) {
    if (err)
      return error('Error cleaning up:' + (err.message || err))

    setImmediate(function () {
      process.exit(pass ? 0 : -1)
    })
  })
}


Workshopper.prototype.pass = function (mode, exercise) {
  console.log(chalk.bold.green('# PASS') + '\n')
  console.log(chalk.bold.yellow('Your solution to ' + exercise.name + ' passed!') + '\n')

  if (exercise.hideSolutions)
    return

  exercise.getSolutionFiles(function (err, files) {
    if (err)
      return error('ERROR: There was a problem printing the solution files: ' + (err.message || err))
    if (!files.length)
      return

    console.log('Here\'s the official solution is if you want to compare notes:\n')

    map(
        files
      , function (file, callback) {
          fs.readFile(file, 'utf8', function (err, content) {
            if (err)
              return callback(err)

            // code fencing is necessary for msee to render the solution as code
            content = msee.parse('```js\n' + content + '\n```')
            callback(null, { file: file, content: content })
          })
        }
      , function (err, solutions) {
          if (err)
            return error('ERROR: There was a problem printing the solution files: ' + (err.message || err))

          var completed = this.getData('completed') || []
            , remaining

          solutions.forEach(function (file, i) {
            console.log(chalk.bold.yellow(repeat('\u2500', 90)) + '\n')

            if (solutions.length > 1)
              console.log(chalk.bold.yellow(file.name + ':') + '\n')

            console.log(file.content)

            if (i == solutions.length - 1)
              console.log(chalk.bold.yellow(repeat('\u2500', 90)) + '\n')
          }.bind(this))

          this.updateData('completed', function (xs) {
            if (!xs)
              xs = []

            return xs.indexOf(exercise.name) >= 0 ? xs : xs.concat(exercise.name)
          })

          completed = this.getData('completed') || []

          remaining = this.exercises.length - completed.length

          if (remaining === 0) {
            console.log(chalk.bold.yellow('You\'ve finished all the challenges! Hooray!') + '\n')
          } else {
            console.log(
                'You have '
              + remaining
              + ' challenge'
              + (remaining != 1 ? 's' : '')
              + ' left.'
            )
            console.log('Type `' + this.appName + '` to show the menu.\n')
          }

          this.end(mode, true, exercise)
        }.bind(this)
    )
  }.bind(this))
}


Workshopper.prototype.execute = function (mode, args) {
  var current  = this.getData('current')
    , exercise = current && this.loadExercise(current)

  if (!current)
    return error('No active exercise. Select one from the menu.')

  if (!exercise)
    return error('No such exercise: ' + name)

  exercise[mode](args, function (err, pass) {
    if (err)
      return error('Could not ' + mode + ': ' + (err.message || err))

    if (mode == 'run')
      return // nothing to see here

    if (!pass)
      return this.fail(mode, exercise)

    this.pass(mode, exercise)
  }.bind(this))
}


Workshopper.prototype.printMenu = function () {
  var menu = showMenu({
      name          : this.appName
    , title         : this.title
    , subtitle      : this.subtitle
    , width         : this.width
    , completed     : this.getData('completed') || []
    , exercises     : this.exercises
    , menu          : this.menuOptions
    , credits       : this.creditsFile && fs.existsSync(this.creditsFile)
    , prerequisites : this.prerequisitesFile && fs.existsSync(this.prerequisitesFile)
  })

  menu.on('select', onselect.bind(this))
  menu.on('exit', function () {
    console.log()
    process.exit(0)
  })
  menu.on('help', function () {
    console.log()
    return this._printHelp()
  }.bind(this))
  menu.on('credits', function () {
    console.log()
    return this._printCredits()
  }.bind(this))
  menu.on('prerequisites', function () {
    console.log()
    return this._printPrerequisites()
  }.bind(this))
}


Workshopper.prototype.getData = function (name) {
  var file = path.resolve(this.dataDir, name + '.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {}
  return null
}


Workshopper.prototype.updateData = function (id, fn) {
  var json = {}
    , file

  try {
    json = this.getData(id)
  } catch (e) {}

  file = path.resolve(this.dataDir, id + '.json')
  fs.writeFileSync(file, JSON.stringify(fn(json)))
}


Workshopper.prototype.dirFromName = function (name) {
  return util.dirFromName(this.exerciseDir, name)
}


Workshopper.prototype._printHelp = function () {
  this._printUsage()

  if (this.helpFile)
    print.file(this.appName, this.appDir, this.helpFile)
}


Workshopper.prototype._printCredits = function () {
  if (this.creditsFile)
    print.file(this.appName, this.appDir, this.creditsFile)
}


Workshopper.prototype._printPrerequisites = function () {
  if (this.prerequisitesFile)
    print.file(this.appName, this.appDir, this.prerequisitesFile)
}


Workshopper.prototype._printUsage = function () {
  print.file(this.appName, this.appDir, path.join(__dirname, './usage.txt'))
}


function printExercise (type, exerciseText) {
  print.text(this.appName, this.appDir, type, exerciseText)

  console.log(
    chalk.bold('\n » To print these instructions again, run: `' + this.appName + ' print`.'))
  console.log(
    chalk.bold(' » To execute your program in a test environment, run:\n   `' + this.appName + ' run program.js`.'))
  console.log(
    chalk.bold(' » To verify your program, run: `' + this.appName + ' verify program.js`.'))

  if (this.helpFile) {
    console.log(
      chalk.bold(' » For help with this exercise or with ' + this.appName + ', run:\n   `' + this.appName + ' help`.'))
  }

  if (this.creditsFile) {
    console.log(chalk.bold(
        ' » For a list of those who contributed to '
      + this.appName
      + ', run:\n   `'
      + this.appName
      + ' credits`.'
    ))
  }

  if (this.prerequisitesFile) {
    console.log(chalk.bold(
        ' » For any set up/installion prerequisites for '
      + this.appName
      + ', run:\n   `'
      + this.appName
      + ' prerequisites`.'
    ))
  }

  console.log()
}


Workshopper.prototype.loadExercise = function (name) {
  name = name.toLowerCase().trim()

  var number
    , dir
    , id
    , exerciseFile
    , stat
    , exercise

  this.exercises.some(function (_name, i) {
    if (_name.toLowerCase().trim() != name)
      return false

    number = i + 1
    name   = _name
    return true
  })

  if (number === undefined)
    return null

  dir          = this.dirFromName(name)
  id           = util.idFromName(name)
  exerciseFile = path.join(dir, './exercise.js')
  stat         = fs.statSync(exerciseFile)

  if (!stat || !stat.isFile())
    return error('ERROR:', exerciseFile, 'does not exist!')

  exercise     = require(exerciseFile)

  if (!exercise || typeof exercise.init != 'function')
    return error('ERROR:', exerciseFile, 'is not a workshopper exercise')

  exercise.init(id, name, dir, number)

  return exercise
}


function onselect (name) {
  var exercise = this.loadExercise(name)

  if (!exercise)
    return error('No such exercise: ' + name)

  console.log()
  console.log(' ' + chalk.green.bold(this.title))
  console.log(chalk.green.bold(repeat('\u2500', chalk.stripColor(this.title).length + 2)))
  console.log(' ' + chalk.yellow.bold(exercise.name))
  console.log(' ' + chalk.yellow.italic('Exercise', exercise.number, 'of', this.exercises.length))
  console.log()

  this.updateData('current', function () {
    return exercise.name
  })

  exercise.prepare(function (err) {
    if (err)
      return error('Error preparing exercise:', err.message || err)

    exercise.getExerciseText(function (err, type, exerciseText) {
      if (err)
        return error('Error loading exercise text:', err.message || err)

      printExercise(type, exerciseText)
    }.bind(this))
  })
}


function error () {
  var pr = chalk.bold.red
  console.log(pr.apply(pr, arguments))
  process.exit(-1)
}


module.exports = Workshopper