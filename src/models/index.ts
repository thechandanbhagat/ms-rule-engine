/**
 * Represents an action context with key-value pairs
 */
export interface ActionContext {
  [key: string]: any;
}

/**
 * Represents an action to be executed after rule evaluation
 */
export interface RuleAction {
  name: string;
  context?: ActionContext;
}

/**
 * Represents actions that can be executed on success or failure
 */
export interface RuleActions {
  onSuccess?: RuleAction;
  onFailure?: RuleAction;
}

/**
 * Represents a scoped parameter that can be used in rule expressions
 */
export interface ScopedParam {
  name: string;
  expression: string;
}

/**
 * Supported operators for nested rules
 */
export enum RuleOperator {
  And = 'And',
  Or = 'Or'
}

/**
 * Supported rule expression types
 */
export enum RuleExpressionType {
  LambdaExpression = 'LambdaExpression'
}

/**
 * Represents a single rule within a workflow
 */
export interface Rule {
  ruleName: string;
  expression?: string;
  operator?: RuleOperator;
  errorMessage?: string;
  errorType?: string;
  successEvent?: string;
  ruleExpressionType?: RuleExpressionType;
  localParams?: ScopedParam[];
  actions?: RuleActions;
  rules?: Rule[];  // For nested rules
  enabled?: boolean;
}

/**
 * Represents a workflow containing multiple rules
 */
export interface Workflow {
  workflowName: string;
  rules: Rule[];
  globalParams?: ScopedParam[];
}

/**
 * Represents a parameter input to the rules engine
 */
export class RuleParameter {
  public name: string;
  public value: any;

  constructor(name: string, value: any) {
    this.name = name;
    this.value = value;
  }
}

/**
 * Represents the result of an action execution
 */
export interface ActionResult {
  output?: any;
  exception?: Error;
}

/**
 * Represents the result of a rule evaluation
 */
export interface RuleResult {
  rule: Rule;
  isSuccess: boolean;
  actionResult?: ActionResult;
  childResults?: RuleResult[];
  exceptionMessage?: string;
}

/**
 * Configuration settings for the Rules Engine
 */
export interface ReSettings {
  customTypes?: { [key: string]: any };
  customActions?: { [key: string]: () => ActionBase };
  enableExceptionAsErrorMessage?: boolean;
  ignoreException?: boolean;
  enableFormattedErrorMessage?: boolean;
  enableScopedParams?: boolean;
  isExpressionCaseSensitive?: boolean;
  autoRegisterInputType?: boolean;
  nestedRuleExecutionMode?: NestedRuleExecutionMode;
}

/**
 * Nested rule execution modes
 */
export enum NestedRuleExecutionMode {
  All = 'All',
  Performance = 'Performance'
}

/**
 * Base class for custom actions
 */
export abstract class ActionBase {
  abstract run(
    context: ActionContext,
    ruleParameters: RuleParameter[],
    scopedParams?: { [key: string]: any }
  ): Promise<any>;
}