/**
 * The default forum structure `seedForums` creates on a fresh site: categories,
 * their forums, and each forum's class gates. Data only; moved out of
 * bootstrap.ts so the seeders stay readable (#596).
 */
// minClassRead/Write 200 = Power User+; 0 = everyone; 500 = Staff+
export const FORUM_STRUCTURE = [
  {
    name: 'Site',
    sort: 10,
    forums: [
      {
        sort: 10,
        name: 'Announcements',
        description:
          'There are a terrible lot of lies going about the world and the worst of it is that half of them are true.'
      },
      {
        sort: 20,
        name: 'Stellar',
        description: 'News and updates about the Stellar project.'
      },
      {
        sort: 30,
        name: 'Contests & Designs',
        description: 'Community contests and design submissions.'
      },
      {
        sort: 40,
        name: 'Projects',
        description: 'Ongoing and upcoming projects.'
      },
      {
        sort: 50,
        name: 'The Laboratory',
        description:
          'I was working in the lab late one night when my eyes beheld an eerie sight.'
      },
      {
        sort: 60,
        name: 'Suggestions/Ideas',
        description:
          'Daring ideas are like chessmen moved forward, they may be beaten, but you may start a winning game.'
      },
      {
        sort: 70,
        name: 'Bugs',
        description:
          'Some days you are the bug and some days you are the windshield.'
      }
    ]
  },
  {
    name: 'Community',
    sort: 20,
    forums: [
      {
        sort: 10,
        name: 'The Lounge',
        description:
          "The only normal people you know are the ones you don't know very well."
      },
      {
        sort: 20,
        name: 'The Lounge+',
        description: 'There are points to be scored. There are games to be won.'
      },
      {
        sort: 30,
        name: 'The Library',
        description:
          'The first sign of maturity is the discovery that the volume knob also turns to the left.'
      },
      {
        sort: 40,
        name: 'Concerts, Events & Meets',
        description:
          "No, it's just pure noise for the hell of it. The fun is in watching people's faces. That's why we light the audience up, to see their discomfort."
      },
      {
        sort: 50,
        name: 'Power User',
        description:
          'Destiny is not a matter of chance, it is a matter of choice. It is not a thing to be waited for, it is a thing to be achieved.',
        minClassRead: 200,
        minClassWrite: 200
      },
      {
        sort: 60,
        name: 'Elite',
        description:
          "I don't believe in elitism, I don't think the audience is this dumb person lower than me. I am the audience.",
        minClassRead: 300,
        minClassWrite: 300
      },
      {
        sort: 70,
        name: 'Technology',
        description:
          'The real danger is not that computers will begin to think like men, but men will begin to think like computers.'
      }
    ]
  },
  {
    name: 'Music',
    sort: 30,
    forums: [
      {
        sort: 10,
        name: 'Music',
        description:
          'This witty remark only works with accompanied by the sweet harmonies of acoustic guitars.'
      },
      {
        sort: 20,
        name: 'Vanity House',
        description: 'Share your own music and productions.'
      },
      {
        sort: 30,
        name: 'The Studio',
        description: 'Production, mixing, and recording techniques.'
      },
      {
        sort: 40,
        name: 'Offered',
        description: 'Share and exchange music recommendations.'
      },
      {
        sort: 50,
        name: 'Vinyl',
        description:
          "I don't think it's real unless you put it on an LP. CDs aren't real. Anybody can do that."
      }
    ]
  },
  {
    name: 'Help',
    sort: 40,
    forums: [
      {
        sort: 10,
        name: 'Help',
        description:
          'In helping others we shall help ourselves, for whatever good we give out completes the circle and comes back to us.'
      },
      {
        sort: 20,
        name: 'Tutorials',
        description:
          'He that gives good advice works with one hand, he who gives counsel and example builds with both.'
      }
    ]
  },
  {
    name: 'Staff',
    sort: 90,
    forums: [
      {
        sort: 10,
        name: 'Staff',
        description: 'Internal staff discussion.',
        minClassRead: 500,
        minClassWrite: 500
      }
    ]
  },
  {
    name: 'Trash',
    sort: 100,
    forums: [
      {
        sort: 10,
        name: 'Trash',
        description: 'Moved or removed topics.',
        isTrash: true,
        minClassRead: 500,
        minClassWrite: 500,
        minClassCreate: 500
      }
    ]
  }
] as const;

export type ForumEntry = {
  sort: number;
  name: string;
  description: string;
  minClassRead?: number;
  minClassWrite?: number;
  minClassCreate?: number;
  isTrash?: boolean;
};
