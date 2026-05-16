import winston from 'winston';
import { logging as config } from './config';

const { Container, format, transports } = winston;
const { combine, json, label, prettyPrint, printf, timestamp } = format;

const loggers: { [key: string]: winston.Logger } = {};
const container = new Container();

const createLogger = (
  category: string,
  categoryLabel: string
): winston.Logger => {
  const isProduction = process.env.NODE_ENV === 'production';

  let fmt: winston.Logform.Format;

  if (isProduction) {
    fmt = combine(timestamp(), label({ label: categoryLabel }), json());
  } else {
    let formatter = (info: winston.Logform.TransformableInfo) =>
      `[${info.level}][${info.label}] ${info.message}`;

    const formatters: winston.Logform.Format[] = [
      label({ label: categoryLabel })
    ];

    if (config.timestampFormat) {
      formatters.push(timestamp({ format: config.timestampFormat }));
      formatter = (info) =>
        `${info.timestamp} [${info.level}][${info.label}] ${info.message}`;
    }

    formatters.push(prettyPrint(), printf(formatter));
    fmt = combine(...formatters);
  }

  container.add(category, {
    transports: [new transports.Console({ level: config.level, format: fmt })]
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
