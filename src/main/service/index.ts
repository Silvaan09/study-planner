// The study service: all business rules and SQL. Split into layers, each extending the previous one:
// base → semesters → lectures → exams → exercises → exerciseUpdates → views → trash → overview.
import { OverviewService } from './overview';

export { UserError } from './base';
export { alignSessions, seriesTitle, statusAfterSession, statusAfterStep, withStatus } from './status';

export class StudyService extends OverviewService {}
