const readline = require('readline');

let rl = null;

function getRL() {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return rl;
}

function ask(question) {
  return new Promise(resolve => {
    getRL().question(question, answer => {
      resolve(answer.trim());
    });
  });
}

function close() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

module.exports = { ask, close };
