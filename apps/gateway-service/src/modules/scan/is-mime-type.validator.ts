import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'isMimeType', async: false })
export class IsMimeType implements ValidatorConstraintInterface {
  validate(file: any, args: ValidationArguments) {
    return file && file.mimetype === args.constraints[0];
  }

  defaultMessage(args: ValidationArguments) {
    return `File must be of type ${args.constraints[0]}`;
  }
}
