import type { Question } from './types';

/** Placeholder bank; replaced by a real, mixed set later. */
export const QUESTION_BANK: readonly Question[] = [
  {
    text: 'What is the capital of France?',
    options: ['Paris', 'Lyon', 'Nice', 'Lille'],
    correct: 0,
  },
  { text: 'How many legs does a spider have?', options: ['6', '8', '10', '12'], correct: 1 },
  {
    text: 'Which planet is known as the Red Planet?',
    options: ['Venus', 'Jupiter', 'Mars', 'Mercury'],
    correct: 2,
  },
  { text: 'What is 7 x 8?', options: ['54', '56', '58', '64'], correct: 1 },
  {
    text: 'Which ocean is the largest?',
    options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'],
    correct: 3,
  },
  {
    text: 'Who painted the Mona Lisa?',
    options: ['Da Vinci', 'Monet', 'Picasso', 'Van Gogh'],
    correct: 0,
  },
  { text: 'What is the chemical symbol for gold?', options: ['Ag', 'Au', 'Gd', 'Go'], correct: 1 },
  { text: 'How many continents are there?', options: ['5', '6', '7', '8'], correct: 2 },
  {
    text: 'Which animal is the tallest?',
    options: ['Elephant', 'Giraffe', 'Horse', 'Camel'],
    correct: 1,
  },
  {
    text: 'What is the hardest natural substance?',
    options: ['Quartz', 'Steel', 'Diamond', 'Granite'],
    correct: 2,
  },
  {
    text: 'Which country is home to the kangaroo?',
    options: ['Australia', 'Brazil', 'India', 'Kenya'],
    correct: 0,
  },
  { text: 'How many minutes are in two hours?', options: ['100', '110', '120', '140'], correct: 2 },
  {
    text: 'What gas do plants absorb from the air?',
    options: ['Oxygen', 'Nitrogen', 'Helium', 'Carbon dioxide'],
    correct: 3,
  },
  { text: 'Which is the smallest prime number?', options: ['0', '1', '2', '3'], correct: 2 },
  {
    text: 'What colour do you get mixing blue and yellow?',
    options: ['Green', 'Purple', 'Orange', 'Brown'],
    correct: 0,
  },
  {
    text: 'Which instrument has 88 keys?',
    options: ['Guitar', 'Piano', 'Violin', 'Flute'],
    correct: 1,
  },
  {
    text: 'In which sport would you score a try?',
    options: ['Tennis', 'Golf', 'Rugby', 'Cricket'],
    correct: 2,
  },
  {
    text: 'What is the largest mammal?',
    options: ['Blue whale', 'Elephant', 'Hippo', 'Orca'],
    correct: 0,
  },
  { text: 'How many sides does a hexagon have?', options: ['5', '6', '7', '8'], correct: 1 },
  {
    text: 'Which planet has prominent rings?',
    options: ['Mars', 'Earth', 'Neptune', 'Saturn'],
    correct: 3,
  },
  { text: 'What is frozen water called?', options: ['Steam', 'Ice', 'Dew', 'Fog'], correct: 1 },
  {
    text: 'Which month has the fewest days?',
    options: ['January', 'February', 'April', 'June'],
    correct: 1,
  },
  { text: 'What is the square root of 81?', options: ['7', '8', '9', '10'], correct: 2 },
  {
    text: 'Which bird is famous for not flying and living in Antarctica?',
    options: ['Penguin', 'Ostrich', 'Emu', 'Kiwi'],
    correct: 0,
  },
];
