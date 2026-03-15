import { ExpressionEvaluator } from './ExpressionEvaluator';
import { 
  Workflow, 
  Rule, 
  RuleResult, 
  RuleParameter, 
  ReSettings, 
  NestedRuleExecutionMode,
  RuleOperator,
  ActionResult
} from '../models';

/**
 * Main Rules Engine class for executing JSON-based business rules
 */
export class RulesEngine {
  private workflows: Map<string, Workflow> = new Map();
  private expressionEvaluator: ExpressionEvaluator;
  private settings: ReSettings;

  constructor(workflows: Workflow[], settings: ReSettings = {}) {
    this.settings = {
      enableExceptionAsErrorMessage: true,
      ignoreException: false,
      enableFormattedErrorMessage: true,
      enableScopedParams: true,
      isExpressionCaseSensitive: false,
      autoRegisterInputType: true,
      nestedRuleExecutionMode: NestedRuleExecutionMode.All,
      ...settings
    };

    this.expressionEvaluator = new ExpressionEvaluator(this.settings);
    
    // Load workflows into internal map
    workflows.forEach(workflow => {
      this.workflows.set(workflow.workflowName, workflow);
    });
  }

  /**
   * Executes all rules in a workflow and returns results
   */
  public async executeAllRulesAsync(workflowName: string, ...ruleParameters: RuleParameter[]): Promise<RuleResult[]> {
    const workflow = this.workflows.get(workflowName);
    if (!workflow) {
      throw new Error(`Workflow '${workflowName}' not found`);
    }

    const results: RuleResult[] = [];
    
    // Evaluate global scoped parameters
    let globalScopedParams: { [key: string]: any } = {};
    if (this.settings.enableScopedParams && workflow.globalParams) {
      globalScopedParams = this.expressionEvaluator.evaluateScopedParams(
        workflow.globalParams, 
        ruleParameters
      );
    }

    // Execute each rule in the workflow
    for (const rule of workflow.rules) {
      if (rule.enabled === false) {
        continue;
      }

      const result = await this.executeRule(rule, ruleParameters, globalScopedParams);
      results.push(result);
    }

    return results;
  }

  /**
   * Executes a specific rule by name within a workflow
   */
  public async executeRuleAsync(
    workflowName: string, 
    ruleName: string, 
    ...ruleParameters: RuleParameter[]
  ): Promise<RuleResult | null> {
    const workflow = this.workflows.get(workflowName);
    if (!workflow) {
      throw new Error(`Workflow '${workflowName}' not found`);
    }

    const rule = this.findRuleByName(workflow.rules, ruleName);
    if (!rule) {
      throw new Error(`Rule '${ruleName}' not found in workflow '${workflowName}'`);
    }

    // Evaluate global scoped parameters
    let globalScopedParams: { [key: string]: any } = {};
    if (this.settings.enableScopedParams && workflow.globalParams) {
      globalScopedParams = this.expressionEvaluator.evaluateScopedParams(
        workflow.globalParams, 
        ruleParameters
      );
    }

    return await this.executeRule(rule, ruleParameters, globalScopedParams);
  }

  /**
   * Executes an action workflow (rule with actions)
   */
  public async executeActionWorkflowAsync(
    workflowName: string, 
    ruleName: string, 
    ...ruleParameters: RuleParameter[]
  ): Promise<ActionResult> {
    const result = await this.executeRuleAsync(workflowName, ruleName, ...ruleParameters);
    
    if (!result) {
      throw new Error(`Rule '${ruleName}' not found`);
    }

    return result.actionResult || { output: null };
  }

  /**
   * Executes a single rule with given parameters and scoped context
   */
  private async executeRule(
    rule: Rule, 
    ruleParameters: RuleParameter[], 
    globalScopedParams: { [key: string]: any } = {},
    localScopedParams: { [key: string]: any } = {}
  ): Promise<RuleResult> {
    const result: RuleResult = {
      rule,
      isSuccess: false,
      childResults: []
    };

    try {
      // Combine scoped parameters
      let allScopedParams = { ...globalScopedParams, ...localScopedParams };

      // Evaluate local scoped parameters for this rule
      if (this.settings.enableScopedParams && rule.localParams) {
        const localParams = this.expressionEvaluator.evaluateScopedParams(
          rule.localParams, 
          ruleParameters, 
          allScopedParams
        );
        allScopedParams = { ...allScopedParams, ...localParams };
      }

      // Execute the rule logic
      if (rule.rules && rule.rules.length > 0) {
        // Handle nested rules
        result.isSuccess = await this.executeNestedRules(
          rule, 
          ruleParameters, 
          globalScopedParams, 
          allScopedParams, 
          result
        );
      } else if (rule.expression) {
        // Execute single rule expression
        result.isSuccess = this.expressionEvaluator.evaluate<boolean>(
          rule.expression, 
          ruleParameters, 
          allScopedParams
        );
      } else {
        // Rule with no expression or nested rules defaults to false
        result.isSuccess = false;
      }

      // Execute actions if configured
      await this.executeActions(rule, result, ruleParameters, allScopedParams);

    } catch (error) {
      result.isSuccess = false;
      result.exceptionMessage = error instanceof Error ? error.message : String(error);

      if (!this.settings.ignoreException) {
        if (this.settings.enableExceptionAsErrorMessage) {
          result.exceptionMessage = `Rule execution failed: ${result.exceptionMessage}`;
        } else {
          throw error;
        }
      }
    }

    return result;
  }

  /**
   * Executes nested rules based on the operator (And/Or)
   */
  private async executeNestedRules(
    parentRule: Rule,
    ruleParameters: RuleParameter[],
    globalScopedParams: { [key: string]: any },
    localScopedParams: { [key: string]: any },
    parentResult: RuleResult
  ): Promise<boolean> {
    if (!parentRule.rules || parentRule.rules.length === 0) {
      return false;
    }

    const childResults: RuleResult[] = [];
    const operator = parentRule.operator || RuleOperator.And;
    let overallSuccess = operator === RuleOperator.And; // Start with true for AND, false for OR

    for (const childRule of parentRule.rules) {
      if (childRule.enabled === false) {
        continue;
      }

      // Performance optimization: skip remaining rules if result is already determined
      if (this.settings.nestedRuleExecutionMode === NestedRuleExecutionMode.Performance) {
        if (operator === RuleOperator.And && !overallSuccess) break;
        if (operator === RuleOperator.Or && overallSuccess) break;
      }

      const childResult = await this.executeRule(
        childRule, 
        ruleParameters, 
        globalScopedParams, 
        localScopedParams
      );
      
      childResults.push(childResult);

      // Update overall success based on operator
      if (operator === RuleOperator.And) {
        overallSuccess = overallSuccess && childResult.isSuccess;
      } else if (operator === RuleOperator.Or) {
        overallSuccess = overallSuccess || childResult.isSuccess;
      }
    }

    parentResult.childResults = childResults;
    return overallSuccess;
  }

  /**
   * Executes rule actions (OnSuccess/OnFailure)
   */
  private async executeActions(
    rule: Rule, 
    result: RuleResult, 
    ruleParameters: RuleParameter[],
    scopedParams: { [key: string]: any }
  ): Promise<void> {
    if (!rule.actions) {
      return;
    }

    const actionToExecute = result.isSuccess ? rule.actions.onSuccess : rule.actions.onFailure;
    if (!actionToExecute) {
      return;
    }

    try {
      let actionResult: any = null;

      // Handle built-in actions
      if (actionToExecute.name === 'OutputExpression') {
        const expression = actionToExecute.context?.expression;
        if (expression) {
          actionResult = this.expressionEvaluator.evaluate(
            expression, 
            ruleParameters, 
            scopedParams
          );
        }
      } else if (actionToExecute.name === 'EvaluateRule') {
        const context = actionToExecute.context;
        if (context?.workflowName && context?.ruleName) {
          // Handle filtered inputs
          let filteredParameters = ruleParameters;
          if (context.inputFilter && Array.isArray(context.inputFilter)) {
            filteredParameters = ruleParameters.filter(param => 
              context.inputFilter.includes(param.name)
            );
          }

          // Handle additional inputs
          if (context.additionalInputs && Array.isArray(context.additionalInputs)) {
            for (const additionalInput of context.additionalInputs) {
              const value = this.expressionEvaluator.evaluate(
                additionalInput.expression,
                ruleParameters,
                scopedParams
              );
              filteredParameters.push(new RuleParameter(additionalInput.name, value));
            }
          }

          const chainedResult = await this.executeRuleAsync(
            context.workflowName,
            context.ruleName,
            ...filteredParameters
          );
          
          actionResult = chainedResult?.actionResult?.output || chainedResult?.isSuccess;
        }
      } else if (this.settings.customActions && this.settings.customActions[actionToExecute.name]) {
        // Handle custom actions
        const actionFactory = this.settings.customActions[actionToExecute.name];
        const actionInstance = actionFactory();
        actionResult = await actionInstance.run(actionToExecute.context || {}, ruleParameters, scopedParams);
      }

      result.actionResult = {
        output: actionResult
      };

    } catch (error) {
      result.actionResult = {
        output: null,
        exception: error instanceof Error ? error : new Error(String(error))
      };

      if (!this.settings.ignoreException) {
        throw error;
      }
    }
  }

  /**
   * Finds a rule by name within a rule collection (supports nested search)
   */
  private findRuleByName(rules: Rule[], ruleName: string): Rule | null {
    for (const rule of rules) {
      if (rule.ruleName === ruleName) {
        return rule;
      }
      
      if (rule.rules && rule.rules.length > 0) {
        const found = this.findRuleByName(rule.rules, ruleName);
        if (found) {
          return found;
        }
      }
    }
    
    return null;
  }

  /**
   * Gets all workflow names loaded in the engine
   */
  public getWorkflowNames(): string[] {
    return Array.from(this.workflows.keys());
  }

  /**
   * Gets a workflow by name
   */
  public getWorkflow(workflowName: string): Workflow | undefined {
    return this.workflows.get(workflowName);
  }

  /**
   * Adds or updates a workflow
   */
  public addOrUpdateWorkflow(workflow: Workflow): void {
    this.workflows.set(workflow.workflowName, workflow);
  }

  /**
   * Removes a workflow
   */
  public removeWorkflow(workflowName: string): boolean {
    return this.workflows.delete(workflowName);
  }
}