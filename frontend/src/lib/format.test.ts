import { describe, expect, it } from 'vitest'
import { ApiError, parseProblem } from './api'
import { addDays, formatRange, initials, isWeekend, tenure, toIso } from './format'

describe('date helpers', () => {
  it('adds days across month boundaries without timezone drift', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('formats single-day and multi-day ranges', () => {
    expect(formatRange('2026-09-21', '2026-09-21')).toBe('21 Sep 2026')
    expect(formatRange('2026-09-21', '2026-09-25')).toBe('21 Sep - 25 Sep 2026')
  })

  it('detects weekends', () => {
    expect(isWeekend('2026-09-26')).toBe(true) // Saturday
    expect(isWeekend('2026-09-21')).toBe(false) // Monday
  })

  it('round-trips ISO dates', () => {
    expect(toIso(new Date(2026, 8, 5))).toBe('2026-09-05')
  })

  it('computes tenure text', () => {
    expect(tenure('2023-05-21', new Date(2026, 8, 21))).toBe('3 yr 4 mo')
    expect(tenure('2026-09-01', new Date(2026, 8, 21))).toBe('0 months')
  })

  it('builds initials', () => {
    expect(initials('Shreyas Kanawade')).toBe('SK')
    expect(initials('Madonna')).toBe('M')
  })
})

describe('problem details parsing', () => {
  it('prefers detail, then the first field error, then a friendly status message', () => {
    expect(parseProblem(409, { detail: 'Already approved.' }).message).toBe('Already approved.')
    expect(parseProblem(400, { errors: { email: ['Email is required.'] } }).message).toBe('Email is required.')
    expect(parseProblem(500, null).message).toMatch(/server had a problem/i)
  })

  it('looks up field errors case-insensitively', () => {
    const e = parseProblem(400, { errors: { Email: ['Bad email'] } })
    expect(e).toBeInstanceOf(ApiError)
    expect(e.fieldError('email')).toBe('Bad email')
  })
})
