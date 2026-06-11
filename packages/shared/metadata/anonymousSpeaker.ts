export const ANONYMOUS_SPEAKER_ANIMALS = [
  'Capybara',
  'Axolotl',
  'Pangolin',
  'Quokka',
  'Narwhal',
  'Otter',
  'Hedgehog',
  'Fennec',
  'Octopus',
  'Platypus',
  'Manatee',
  'Sloth',
  'Wombat',
  'Tapir',
  'Lemur',
  'Puffin',
  'Penguin',
  'Walrus',
  'Llama',
  'Alpaca',
  'Mongoose',
  'Okapi',
  'Kakapo',
  'Aardvark',
  'Dugong',
  'Binturong',
  'Coati',
  'Echidna',
  'Gerenuk',
  'Ibex',
  'Jerboa',
  'Kinkajou',
  'Markhor',
  'Numbat',
  'Olinguito',
  'Pika',
  'Quoll',
  'Raccoon',
  'Saiga',
  'Tarsier',
  'Uakari',
  'Vaquita',
  'Wallaby',
  'Xerus',
  'Yapok',
  'Zorilla',
] as const

export function randomAnonymousSpeakerName(
  taken: Iterable<string> = [],
  pick: () => number = Math.random,
): string {
  const takenSet = new Set(taken)
  const available = ANONYMOUS_SPEAKER_ANIMALS.filter(
    (a) => !takenSet.has(`Anonymous ${a}`),
  )
  const pool = available.length > 0 ? available : ANONYMOUS_SPEAKER_ANIMALS
  const i = Math.floor(pick() * pool.length)
  return `Anonymous ${pool[i]}`
}
