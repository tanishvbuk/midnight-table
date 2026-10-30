export interface MissionCard {
  title: string;
  text: string;
}

/**
 * Physical mission cards (R25). Original, indoor, safe for a living room, and need nothing but
 * what is already on the table. The group does the task, then each player votes pass or fail.
 */
export const MISSION_CARDS: readonly MissionCard[] = [
  {
    title: 'The Tower',
    text: 'Build the tallest free-standing tower you can from things on the table. It must stand on its own for five seconds.',
  },
  {
    title: 'Blind Line',
    text: 'Everyone closes their eyes. Without speaking, line up in order of birthday, January first.',
  },
  {
    title: 'Pass the Coin',
    text: 'Pass a coin around the whole circle using only your elbows. If it drops, start again.',
  },
  {
    title: 'One Story',
    text: 'Tell a story one word at a time around the circle. It must make sense and go at least 30 words.',
  },
  {
    title: 'Human Knot',
    text: 'Stand in a circle, grab two different hands across it, and untangle without letting go.',
  },
  {
    title: 'The Silent Orchestra',
    text: 'Make a rhythm using only objects on the table. Everyone must play, and nobody may speak.',
  },
  {
    title: 'Mirror Image',
    text: 'Pair up. One leads a slow movement, the other mirrors it for a full minute without laughing.',
  },
  {
    title: 'Paper Bridge',
    text: 'Make a bridge of paper that spans two chairs a forearm apart and holds a mug.',
  },
  {
    title: 'Count to Twenty',
    text: 'Count to 20 aloud, one person per number, in any order, with no one speaking over another. Start again on a clash.',
  },
  {
    title: 'The Portrait',
    text: 'Draw one portrait of a person in the room, with everyone adding one line, and nobody looking at the model.',
  },
  {
    title: 'Tallest Chain',
    text: 'Make the longest chain you can from anything on you or the table, without tape or glue.',
  },
  {
    title: 'Quiet Room',
    text: 'The whole group stays perfectly silent and still for 60 seconds. Anyone who laughs or moves means failure.',
  },
  {
    title: 'The Alphabet Round',
    text: 'Name one thing in the room for each letter A to Z, one person per letter, no repeats, no pauses over five seconds.',
  },
  {
    title: 'Moving Pile',
    text: 'Move a pile of ten small things from one end of the table to the other, one at a time, balanced on a spoon or book.',
  },
  {
    title: 'The Chant',
    text: 'Invent a short chant with a gesture for every player, and perform it together in time.',
  },
  {
    title: 'Pantomime',
    text: 'Act out a film title without speaking. The group has 90 seconds to guess it.',
  },
  {
    title: 'Pillow Walk',
    text: 'Cross the room, with nobody touching the floor, using only the cushions and pillows you can find.',
  },
  {
    title: 'The Honest Hands',
    text: 'Everyone shows a number of fingers from 0 to 5 at once. The total must be exactly the number of players. Three tries.',
  },
  {
    title: 'Origami Flock',
    text: 'Fold a paper animal each. Together they must be recognisable to someone who did not make them.',
  },
  {
    title: 'The Echo',
    text: 'One player whispers a sentence. Pass it around the circle by ear. The last player says it aloud, and it must match.',
  },
  {
    title: 'Hold the Line',
    text: 'Form a standing circle holding a sheet or towel taut, and pass a ball once around it without it falling.',
  },
  {
    title: 'Group Photo Pose',
    text: 'Build a human pyramid-ish pose with no one lifted off the floor, and hold it for ten seconds.',
  },
  {
    title: 'The Rhyme',
    text: 'Make a rhyming couplet about the game, one word per person, and read it out loud.',
  },
  {
    title: 'Sorting Hat',
    text: 'Sort everyone in the room by height without speaking or measuring, then check against the facts.',
  },
  {
    title: 'Coin Tower',
    text: 'Stack as many coins or small flat things as you can into one tower, each added by a different player.',
  },
  {
    title: 'The Mime Meal',
    text: 'Silently act out cooking and serving a meal together. Another player must name the dish.',
  },
  {
    title: 'Name the Sound',
    text: 'One player makes a sound out of sight. Everyone else writes down a guess. At least half must be right.',
  },
  {
    title: 'Slow Motion',
    text: 'Everyone crosses the room in slow motion at the same speed, taking a full minute.',
  },
  {
    title: 'Memory Tray',
    text: 'Put ten items on a tray, cover it, take one away. The group must name the missing item together.',
  },
  {
    title: 'Group Hum',
    text: 'Hum a well-known tune together without anyone naming it. A bystander must be able to name the tune.',
  },
];
