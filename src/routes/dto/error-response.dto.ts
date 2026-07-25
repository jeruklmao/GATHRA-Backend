import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorDetailDto {
  @ApiProperty({ example: 'origin.latitude' })
  field!: string;

  @ApiProperty({ example: 'must not be less than -90' })
  reason!: string;
}

export class ApiErrorDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({
    example: 'The route preview request is invalid.',
  })
  message!: string;

  @ApiProperty({ example: false })
  retryable!: boolean;

  @ApiPropertyOptional({ type: [ApiErrorDetailDto] })
  details?: ApiErrorDetailDto[];
}

export class ApiErrorResponseDto {
  @ApiProperty({
    description:
      'Generated UUID or a validated client-supplied X-Request-Id value.',
    example: 'gathra-android-42',
  })
  requestId!: string;

  @ApiProperty({ type: ApiErrorDto })
  error!: ApiErrorDto;
}
