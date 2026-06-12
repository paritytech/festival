import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANONYMOUS_SPEAKER_ANIMALS,
  randomAnonymousSpeakerName,
} from '../metadata/anonymousSpeaker'

test('randomAnonymousSpeakerName: starts with "Anonymous " and uses a known animal', () => {
  const name = randomAnonymousSpeakerName()
  assert.ok(name.startsWith('Anonymous '), `got: ${name}`)
  const animal = name.slice('Anonymous '.length)
  assert.ok(
    (ANONYMOUS_SPEAKER_ANIMALS as readonly string[]).includes(animal),
    `unknown animal: ${animal}`,
  )
})

test('randomAnonymousSpeakerName: deterministic with injected picker', () => {
  // pick=0 → first animal; pick close to 1 → last animal (Math.floor caps it).
  assert.equal(
    randomAnonymousSpeakerName([], () => 0),
    `Anonymous ${ANONYMOUS_SPEAKER_ANIMALS[0]}`,
  )
  assert.equal(
    randomAnonymousSpeakerName([], () => 0.9999),
    `Anonymous ${ANONYMOUS_SPEAKER_ANIMALS[ANONYMOUS_SPEAKER_ANIMALS.length - 1]}`,
  )
})

test('randomAnonymousSpeakerName: skips taken names', () => {
  const first = ANONYMOUS_SPEAKER_ANIMALS[0]
  const second = ANONYMOUS_SPEAKER_ANIMALS[1]
  // pick=0 would normally yield the first animal; with it taken, expect the second.
  assert.equal(
    randomAnonymousSpeakerName([`Anonymous ${first}`], () => 0),
    `Anonymous ${second}`,
  )
})

test('randomAnonymousSpeakerName: falls back to full pool when all taken', () => {
  const allTaken = ANONYMOUS_SPEAKER_ANIMALS.map((a) => `Anonymous ${a}`)
  assert.equal(
    randomAnonymousSpeakerName(allTaken, () => 0),
    `Anonymous ${ANONYMOUS_SPEAKER_ANIMALS[0]}`,
  )
})
