import { archivedGoalsKey, goalActivityKey, goalDetailKey, goalsKey } from './query-keys'

describe('goalsKey', () => {
  it('isolates goals by authenticated epoch', () => {
    expect(goalsKey(7)).toEqual(['goals', 7])
    expect(goalsKey(8)).not.toEqual(goalsKey(7))
  })

  it('isolates the archived-goals cache from the active list and by epoch', () => {
    expect(archivedGoalsKey(7)).toEqual(['goals', 'archived', 7])
    expect(archivedGoalsKey(7)).not.toEqual(goalsKey(7))
    expect(archivedGoalsKey(8)).not.toEqual(archivedGoalsKey(7))
  })

  it('isolates detail and activity by epoch and goal', () => {
    expect(goalDetailKey(7, 3)).toEqual(['goal', 7, 3])
    expect(goalActivityKey(7, 3)).toEqual(['goal-activity', 7, 3])
    expect(goalActivityKey(8, 3)).not.toEqual(goalActivityKey(7, 3))
    expect(goalActivityKey(7, 4)).not.toEqual(goalActivityKey(7, 3))
  })
})
