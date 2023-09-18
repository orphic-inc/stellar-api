import { Request, Response, NextFunction } from 'express';

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = 10000; // 10 seconds

    const timeoutPromise = new Promise<Error & { [key: string]: any }>(
      (resolve) => {
        setTimeout(() => {
          const error: Error & { [key: string]: any } = new Error(
            'Request timeout'
          );
          error.statusCode = 408; // Request Timeout
          resolve(error);
        }, timeout);
      }
    );

    Promise.race([fn(req, res, next), timeoutPromise])
      .then((result) => {
        if (result instanceof Error) {
          throw result; // Re-throw the timeout error
        }
      })
      .catch((error: any) => {
        // Log the error for debugging purposes
        console.error('Error:', error);

        // Set default status code and message
        let statusCode = 500;
        let message = 'Server error';

        // Specific error handling
        if (error.statusCode) {
          statusCode = error.statusCode;
        }

        if (error.message) {
          message = error.message;
        }

        if (error.name === 'ValidationError') {
          // Maybe replace this with Prisma-specific validation error handling
          statusCode = 400;
          message = 'Validation error';
        } else if (error.name === 'RequestTimeout') {
          statusCode = 408;
          message = 'Request timeout';
        }

        res.status(statusCode).json({ error: message });
      });
  };
};
