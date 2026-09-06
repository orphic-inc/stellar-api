import { NextFunction, Request, Response } from 'express';
import { isIpBanned } from '../modules/ipBan';
import { getLogger } from '../modules/logging';

const log = getLogger('ipBan');

/**
 * Refuse a banned network, before routing (#540).
 *
 * Mounted globally rather than on the auth paths, because an IP ban means "this
 * network does not get in" — a member already holding a valid session cookie
 * would otherwise keep full access from a banned address until their token
 * expired. It sits after `trust proxy` is configured, so `req.ip` is the address
 * nginx observed rather than one the client chose (#542).
 *
 * The ban applies to everyone, staff included. An exemption would have to load
 * the session first, which defeats refusing before routing and adds a bypass
 * path to reason about; a moderator who bans their own network can be let back
 * in from elsewhere, whereas a wrong exemption is a hole nobody sees.
 *
 * The message is deliberately non-specific — enough to stop someone retrying,
 * not enough to confirm a moderation decision — matching how the email
 * blacklist refuses.
 */
export const rejectBannedIps = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (await isIpBanned(req.ip)) {
      log.warn('Refused a banned address', { path: req.path });
      res
        .status(403)
        .json({ msg: 'Access from this network is not permitted' });
      return;
    }
  } catch (err) {
    // Fail open. A database hiccup here would otherwise refuse every request on
    // the site; a ban that misses for one request is the lesser failure by a
    // wide margin.
    log.error('Ban check failed — allowing the request', { err });
  }
  next();
};
