/**
 * Logger utility with timestamps and styled outputs
 */

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function timestamp() {
  const now = new Date();
  return `${colors.gray}[${now.toLocaleTimeString()}]${colors.reset}`;
}

export const logger = {
  info: (msg, ...args) => {
    console.log(`${timestamp()} ${colors.cyan}ℹ [INFO]${colors.reset} ${msg}`, ...args);
  },
  success: (msg, ...args) => {
    console.log(`${timestamp()} ${colors.green}✔ [SUCCESS]${colors.reset} ${msg}`, ...args);
  },
  warn: (msg, ...args) => {
    console.warn(`${timestamp()} ${colors.yellow}⚠ [WARN]${colors.reset} ${msg}`, ...args);
  },
  error: (msg, ...args) => {
    console.error(`${timestamp()} ${colors.red}✖ [ERROR]${colors.reset} ${msg}`, ...args);
  },
  forward: (fromName, toName, author, preview) => {
    console.log(
      `${timestamp()} ${colors.magenta}➔ [FORWARD]${colors.reset} ` +
      `[#${fromName} ➜ #${toName}] ` +
      `${colors.bright}${author}${colors.reset}: ` +
      `${preview ? (preview.length > 60 ? preview.substring(0, 60) + '...' : preview) : '<Attachment/Embed>'}`
    );
  }
};
