import winston from 'winston';
import { logging as config } from './config.ts';

interface LoggerConfig {
  level: string;
  timestampFormat?: string;
}

const { Container, format, transports } = winston;
const { combine, label, prettyPrint, printf, timestamp } = format;

const loggers: { [key: string]: winston.Logger } = {};
const container = new Container();

const createLogger = (
  category: string,
  categoryLabel: string
): winston.Logger => {
  // Custom log formatter
  let formatter = (info: winston.Logform.TransformableInfo) =>
    `[${info.level}][${info.label}] ${info.message}`;

  // Initial set of formats to apply
  const formatters: Array<typeof winston.format> = [
    label({ label: categoryLabel }) as any
  ];

  // Optional timestamp format from config
  if (config.timestampFormat) {
    formatters.push(timestamp({ format: config.timestampFormat }) as any);
    formatter = (info) =>
      `${info.timestamp} [${info.level}][${info.label}] ${info.message}`;
  }

  // Adding pretty print and custom formatter
  formatters.push(prettyPrint() as any, printf(formatter) as any);

  // Adding a new logger to the container
  container.add(category, {
    transports: [
      new transports.Console({
        level: config.level,
        format: combine(...(formatters as any))
      })
    ]
  });

  return container.get(category);
};

export const getLogger = (
  category: string,
  categoryLabel: string = category
): winston.Logger => {
  if (!loggers[category]) {
    loggers[category] = createLogger(category, categoryLabel);
  }
  return loggers[category];
};
